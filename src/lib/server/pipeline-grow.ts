/**
 * Growing and reshaping the pipeline (spec: Pipeline changes): adding a stage, moving a
 * book to another track, and creating or deleting tracks. Previewed, then saved as one
 * undoable batch. Started tasks are never moved or deleted.
 */
import { error } from '@sveltejs/kit';
import { and, asc, eq, inArray, isNull, max } from 'drizzle-orm';
import { ulid } from 'ulid';
import { db } from '#lib/server/db/index.ts';
import {
	activityLog, bookStageSkips, books, dependencies, stageLinks, stageTracks, stages, tasks, tracks
} from '#lib/server/db/schema.ts';
import type { StageLink } from '../schedule/pattern.ts';
import { planRelink } from '../schedule/relink.ts';
import { loadSeriesContext } from './series-context.ts';
import { seriesPattern } from './pipeline-structure.ts';
import { deleteTasks, isStarted, logger } from './removal.ts';
import { describePlan, planNewTasks, writePlan } from './stage-tasks.ts';

type StageRow = typeof stages.$inferSelect;
type Dep = typeof dependencies.$inferSelect;

async function seriesDeps(seriesId: string): Promise<Dep[]> {
	return db.select({ d: dependencies }).from(dependencies)
		.innerJoin(tasks, eq(tasks.id, dependencies.successorId))
		.innerJoin(books, eq(books.id, tasks.bookId))
		.where(eq(books.seriesId, seriesId))
		.then((r) => r.map((x) => x.d));
}

async function trackStageRows(trackId: string): Promise<StageRow[]> {
	return db.select({ s: stages }).from(stageTracks).innerJoin(stages, eq(stages.id, stageTracks.stageId))
		.where(and(eq(stageTracks.trackId, trackId), isNull(stages.archivedAt)))
		.orderBy(asc(stages.sortOrder)).then((r) => r.map((x) => x.s));
}

/** A key unique in the series, derived from a name: "Cover Design" -> "cover_design". */
async function uniqueKey<T extends { key: string }>(name: string, taken: T[]) {
	const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'item';
	const keys = new Set(taken.map((t) => t.key));
	let key = base;
	for (let n = 2; keys.has(key); n++) key = `${base}_${n}`;
	return key;
}

// ── Add a stage ────────────────────────────────────────────────────────────────

export type AddStageInput = {
	name: string;
	category: StageRow['category'];
	defaultDays: number;
	isReview?: boolean;
	isExternal?: boolean;
	ignoresWindows?: boolean;
	trackIds: string[];
	after?: string | null;
	before?: string | null;
	mode: 'insert' | 'alongside';
	bookIds?: string[];
};

/**
 * Add a stage to one or more tracks. It joins the series' dependency pattern after one
 * stage and before another: "insert" replaces the direct link between them, "alongside"
 * keeps it (as the ISBN process runs alongside layout). Ticked books get a task placed
 * after its predecessor; unticked ones record a skip. By default every book on the
 * tracks is ticked except those whose next stage has already started.
 */
export async function addStage(opts: { seriesId: string; actorId: string; input: AddStageInput; preview: boolean; today: string }) {
	const { seriesId, input } = opts;
	const all = await db.select().from(stages).where(eq(stages.seriesId, seriesId));
	const live = all.filter((s) => !s.archivedAt);
	const byId = new Map(live.map((s) => [s.id, s]));

	const seriesTracks = await db.select().from(tracks).where(eq(tracks.seriesId, seriesId));
	if (!input.trackIds.length || input.trackIds.some((id) => !seriesTracks.some((t) => t.id === id)))
		throw error(400, 'Choose at least one track in this series.');
	const after = input.after ? byId.get(input.after) : null;
	const before = input.before ? byId.get(input.before) : null;
	if ((input.after && !after) || (input.before && !before)) throw error(400, 'Choose stages in this series to place the new one between.');
	if (after && before && after.id === before.id) throw error(400, 'The stage it starts after and finishes before must differ.');
	if (input.category === 'gate' && input.defaultDays !== 0) throw error(400, 'A gate has no duration: set its default days to 0.');
	if (input.category !== 'gate' && input.defaultDays < 1) throw error(400, 'A working stage needs at least 1 default day.');

	const stageId = ulid();
	const sortOrder = after ? after.sortOrder + 1 : before ? before.sortOrder : Math.max(0, ...all.map((s) => s.sortOrder)) + 1;
	const stage: StageRow = {
		id: stageId, seriesId, key: await uniqueKey(input.name, all), name: input.name, category: input.category, sortOrder,
		defaultDays: input.defaultDays, isReview: input.isReview ? 1 : 0, isExternal: input.isExternal ? 1 : 0,
		ignoresWindows: input.ignoresWindows ? 1 : 0, deadlineRule: null, archivedAt: null,
	};

	// The new pattern: after -> new -> before; "insert" drops the direct after -> before link.
	const oldPattern = await seriesPattern(seriesId);
	const addLinks: StageLink[] = [
		...(after ? [{ from: after.id, to: stageId, lagDays: 0 }] : []),
		...(before ? [{ from: stageId, to: before.id, lagDays: 0 }] : []),
	];
	const dropLinks = input.mode === 'insert' && after && before
		? oldPattern.filter((l) => l.from === after.id && l.to === before.id)
		: [];
	const pattern = [...oldPattern.filter((l) => !dropLinks.includes(l)), ...addLinks];

	// Books on the chosen tracks; skip by default those whose next stage has started.
	const candidates = await db.select().from(books)
		.where(and(eq(books.seriesId, seriesId), inArray(books.trackId, input.trackIds), isNull(books.archivedAt)))
		.orderBy(asc(books.sortOrder));
	const nextTasks = before && candidates.length
		? await db.select().from(tasks).where(and(eq(tasks.stageId, before.id), inArray(tasks.bookId, candidates.map((b) => b.id))))
		: [];
	const bookList = candidates.map((b) => {
		const next = nextTasks.find((t) => t.bookId === b.id);
		const nextStarted = !!next && (next.status === 'done' || isStarted(next));
		const included = input.bookIds ? input.bookIds.includes(b.id) : !nextStarted;
		return { id: b.id, code: b.code, included, reason: nextStarted ? `${before!.name} has already started` : null };
	});

	const ctx = await loadSeriesContext(seriesId);
	const original = new Map([...ctx.taskMap].map(([k, v]) => [k, { ...v }]));
	const plan = planNewTasks({
		ctx, deps: await seriesDeps(seriesId), pattern, today: opts.today,
		gains: bookList.filter((b) => b.included).map((b) => ({ bookId: b.id, stages: [stage] })),
	});
	const stageName = new Map([...live.map((s) => [s.id, s.name] as const), [stageId, stage.name]]);
	const report = {
		stage: { name: stage.name, key: stage.key },
		books: bookList,
		...describePlan(ctx, plan, original, stageName, new Map(candidates.map((b) => [b.id, b.code]))),
	};
	if (opts.preview) return { preview: true as const, ...report };

	const batchId = ulid();
	const now = new Date().toISOString();
	const log = logger(seriesId, opts.actorId, batchId, now);
	await db.transaction(async (tx) => {
		// Shift later stages right to make room in the column order.
		for (const s of all.filter((x) => x.sortOrder >= sortOrder))
			await tx.update(stages).set({ sortOrder: s.sortOrder + 1 }).where(eq(stages.id, s.id));
		await tx.insert(stages).values(stage);
		await tx.insert(stageTracks).values(input.trackIds.map((trackId) => ({ stageId, trackId })));
		await tx.insert(activityLog).values(log('stage', stageId, 'create', null, { stage, trackIds: input.trackIds }));
		for (const l of dropLinks) {
			const row = { fromStageId: l.from, toStageId: l.to, lagDays: l.lagDays };
			await tx.delete(stageLinks).where(and(eq(stageLinks.fromStageId, l.from), eq(stageLinks.toStageId, l.to)));
			await tx.insert(activityLog).values(log('stage_link', `${l.from}>${l.to}`, 'delete', row, null));
		}
		for (const l of addLinks) {
			const row = { fromStageId: l.from, toStageId: l.to, lagDays: l.lagDays };
			await tx.insert(stageLinks).values(row);
			await tx.insert(activityLog).values(log('stage_link', `${l.from}>${l.to}`, 'create', null, row));
		}
		for (const b of bookList.filter((x) => !x.included)) {
			await tx.insert(bookStageSkips).values({ bookId: b.id, stageId });
			await tx.insert(activityLog).values(log('skip', `${b.id}:${stageId}`, 'create', null, { bookId: b.id, stageId }));
		}
		await writePlan(tx, plan, { seriesId, actorId: opts.actorId, batchId, now, log, original });
	});
	return { preview: false as const, ...report, batchId };
}

// ── Move a book to another track ──────────────────────────────────────────────

/**
 * Stages in both tracks keep their tasks untouched, progress included. Stages only in
 * the old track are removed under the removal rule (started ones block the move; Done
 * ones are kept as history). Stages only in the new track are added after their
 * predecessors.
 */
export async function changeTrack(opts: { bookId: string; trackId: string; actorId: string; preview: boolean; today: string }) {
	const book = await db.select().from(books).where(eq(books.id, opts.bookId)).then((r) => r[0]);
	if (!book || book.archivedAt) throw error(404, 'Book not found');
	const track = await db.select().from(tracks).where(eq(tracks.id, opts.trackId)).then((r) => r[0]);
	if (!track || track.seriesId !== book.seriesId) throw error(400, 'Choose a track in this series.');
	if (track.id === book.trackId) throw error(400, `${book.code} is already on ${track.name}.`);

	const oldStages = await trackStageRows(book.trackId);
	const newStages = await trackStageRows(track.id);
	const newIds = new Set(newStages.map((s) => s.id));
	const oldIds = new Set(oldStages.map((s) => s.id));
	const oldOnly = oldStages.filter((s) => !newIds.has(s.id));
	const newOnly = newStages.filter((s) => !oldIds.has(s.id));

	const own = await db.select().from(tasks).where(eq(tasks.bookId, book.id));
	const leaving = own.filter((t) => oldOnly.some((s) => s.id === t.stageId));
	const started = leaving.filter(isStarted);
	if (started.length) {
		const names = started.map((t) => oldStages.find((s) => s.id === t.stageId)?.name).join(', ');
		throw error(409, `${book.code} cannot move while ${names} ${started.length === 1 ? 'has' : 'have'} started. Finish ${started.length === 1 ? 'it' : 'them'} or reset to Not started first.`);
	}
	const doomed = leaving.filter((t) => t.status !== 'done');
	const keptDone = leaving.filter((t) => t.status === 'done');
	const skips = await db.select().from(bookStageSkips).where(eq(bookStageSkips.bookId, book.id));
	const droppedSkips = skips.filter((k) => oldOnly.some((s) => s.id === k.stageId));
	// Stages the book had skipped on the old track and still shares stay skipped.
	const stillSkipped = new Set(skips.filter((k) => newIds.has(k.stageId)).map((k) => k.stageId));
	const gains = newOnly.filter((s) => !stillSkipped.has(s.id) && !own.some((t) => t.stageId === s.id));

	const deps = await seriesDeps(book.seriesId);
	const { touching, bridges } = planRelink(new Set(doomed.map((t) => t.id)), deps, ulid);
	const ctx = await loadSeriesContext(book.seriesId);
	const original = new Map([...ctx.taskMap].map(([k, v]) => [k, { ...v }]));
	for (const t of doomed) ctx.taskMap.delete(t.id);
	ctx.tasksData = ctx.tasksData.filter((t) => !doomed.some((d) => d.id === t.id));
	const afterRemoval = [...deps.filter((d) => !touching.includes(d)), ...bridges];
	const plan = planNewTasks({
		ctx, deps: afterRemoval, pattern: await seriesPattern(book.seriesId), today: opts.today,
		gains: [{ bookId: book.id, stages: gains }],
	});

	const allStages = await db.select({ id: stages.id, name: stages.name }).from(stages).where(eq(stages.seriesId, book.seriesId));
	const stageName = new Map(allStages.map((s) => [s.id, s.name]));
	const oldTrack = await db.select().from(tracks).where(eq(tracks.id, book.trackId)).then((r) => r[0]);
	const report = {
		book: book.code, from: oldTrack?.name ?? '', to: track.name,
		keeps: own.filter((t) => newIds.has(t.stageId)).length,
		removes: doomed.map((t) => stageName.get(t.stageId) ?? ''),
		keepsDone: keptDone.map((t) => stageName.get(t.stageId) ?? ''),
		...describePlan(ctx, plan, original, stageName, new Map([[book.id, book.code]])),
	};
	if (opts.preview) return { preview: true as const, ...report };

	const batchId = ulid();
	const now = new Date().toISOString();
	const log = logger(book.seriesId, opts.actorId, batchId, now);
	await db.transaction(async (tx) => {
		await deleteTasks(tx, log, doomed, touching, bridges);
		for (const k of droppedSkips) {
			await tx.delete(bookStageSkips).where(and(eq(bookStageSkips.bookId, k.bookId), eq(bookStageSkips.stageId, k.stageId)));
			await tx.insert(activityLog).values(log('skip', `${k.bookId}:${k.stageId}`, 'delete', k, null));
		}
		await tx.update(books).set({ trackId: track.id, version: book.version + 1 }).where(eq(books.id, book.id));
		await tx.insert(activityLog).values(log('book', book.id, 'update', { trackId: book.trackId, version: book.version }, { trackId: track.id, version: book.version + 1 }));
		await writePlan(tx, plan, { seriesId: book.seriesId, actorId: opts.actorId, batchId, now, log, original });
	});
	return { preview: false as const, ...report, batchId };
}

// ── Tracks ─────────────────────────────────────────────────────────────────────

export async function createTrack(opts: { seriesId: string; actorId: string; name: string; stageIds: string[] }) {
	const existing = await db.select().from(tracks).where(eq(tracks.seriesId, opts.seriesId));
	const valid = await db.select({ id: stages.id }).from(stages)
		.where(and(eq(stages.seriesId, opts.seriesId), isNull(stages.archivedAt)));
	if (opts.stageIds.some((id) => !valid.some((s) => s.id === id))) throw error(400, 'Choose stages in this series.');
	if (existing.some((t) => t.name.toLowerCase() === opts.name.toLowerCase())) throw error(409, `There is already a track called ${opts.name}.`);

	const track = {
		id: ulid(), seriesId: opts.seriesId, key: await uniqueKey(opts.name, existing), name: opts.name,
		sortOrder: ((await db.select({ m: max(tracks.sortOrder) }).from(tracks).where(eq(tracks.seriesId, opts.seriesId)))[0]?.m ?? 0) + 1,
	};
	const batchId = ulid();
	const log = logger(opts.seriesId, opts.actorId, batchId, new Date().toISOString());
	await db.transaction(async (tx) => {
		await tx.insert(tracks).values(track);
		if (opts.stageIds.length) await tx.insert(stageTracks).values(opts.stageIds.map((stageId) => ({ stageId, trackId: track.id })));
		await tx.insert(activityLog).values(log('track', track.id, 'create', null, { track, stageIds: opts.stageIds }));
	});
	return { track, batchId };
}

/** Refused while any book, archived or not, follows the track. */
export async function deleteTrack(opts: { trackId: string; actorId: string }) {
	const track = await db.select().from(tracks).where(eq(tracks.id, opts.trackId)).then((r) => r[0]);
	if (!track) throw error(404, 'Track not found');
	const users = await db.select({ code: books.code }).from(books).where(eq(books.trackId, track.id));
	if (users.length)
		throw error(409, `${track.name} is used by ${users.map((b) => b.code).join(', ')}. Move ${users.length === 1 ? 'that book' : 'those books'} to another track first.`);

	const links = await db.select().from(stageTracks).where(eq(stageTracks.trackId, track.id));
	const batchId = ulid();
	const log = logger(track.seriesId, opts.actorId, batchId, new Date().toISOString());
	await db.transaction(async (tx) => {
		await tx.delete(stageTracks).where(eq(stageTracks.trackId, track.id));
		await tx.delete(tracks).where(eq(tracks.id, track.id));
		await tx.insert(activityLog).values(log('track', track.id, 'delete', { track, stageTracks: links }, null));
	});
	return { deleted: track.id, batchId };
}

