/**
 * Structural pipeline changes (spec: Pipeline changes, Structural changes): these create
 * or delete tasks, so they are previewed, then saved as one undoable batch.
 */
import { error } from '@sveltejs/kit';
import { and, asc, eq, inArray, isNull, max } from 'drizzle-orm';
import { ulid } from 'ulid';
import { db, writeAll } from '#lib/server/db/index.ts';
import {
	activityLog, bookStageSkips, books, dependencies, printRecords, series, stageLinks, stageTracks, stages,
	taskAssignees, tasks, windows
} from '#lib/server/db/schema.ts';
import { bookLinks, type StageLink } from '../schedule/pattern.ts';
import { deriveEnd, nextWorkingDay, toWorkingDay } from '../schedule/calendar.ts';
import { buildPredMap, earliestStart, settle, type SchedTask, type WindowRules } from './scheduler.ts';
import { refreshHolidays } from './calendar-db.ts';

type StageRow = typeof stages.$inferSelect;

export async function seriesPattern(seriesId: string): Promise<StageLink[]> {
	return db.select({ from: stageLinks.fromStageId, to: stageLinks.toStageId, lagDays: stageLinks.lagDays })
		.from(stageLinks).innerJoin(stages, eq(stages.id, stageLinks.fromStageId))
		.where(eq(stages.seriesId, seriesId));
}

export type AddBookInput = {
	code: string;
	name: string;
	trackId: string;
	groupLabel?: string | null;
	batch?: number | null;
	schedule: { likeBookId: string } | { fromDate?: string; skipStageIds?: string[] };
};

type NewTask = typeof tasks.$inferInsert & { assignees: { personId: string; isLead: number }[] };

/**
 * Add a book. "Like another book" copies a sibling's dates, windows, skips and assignees;
 * "From a date" chains the track's stages from a date with default durations, placing
 * them in windows like a slip. Either way the series' dependency pattern links the tasks
 * and a print record is created from the series defaults.
 */
export async function addBook(opts: { seriesId: string; actorId: string; input: AddBookInput; preview: boolean; today: string }) {
	const { seriesId, actorId, input } = opts;
	await refreshHolidays();
	// One round trip for what every book needs: the series, a code clash, the track's stages,
	// the dependency pattern, windows and the next sort position.
	const [serRows, clash, trackStageRows, pattern, wins, maxSort] = await db.batch([
		db.select().from(series).where(eq(series.id, seriesId)),
		db.select({ id: books.id }).from(books).where(and(eq(books.seriesId, seriesId), eq(books.code, input.code))),
		db.select({ s: stages }).from(stageTracks).innerJoin(stages, eq(stages.id, stageTracks.stageId))
			.where(and(eq(stageTracks.trackId, input.trackId), eq(stages.seriesId, seriesId), isNull(stages.archivedAt))).orderBy(asc(stages.sortOrder)),
		db.select({ from: stageLinks.fromStageId, to: stageLinks.toStageId, lagDays: stageLinks.lagDays })
			.from(stageLinks).innerJoin(stages, eq(stages.id, stageLinks.fromStageId)).where(eq(stages.seriesId, seriesId)),
		db.select().from(windows).where(eq(windows.seriesId, seriesId)).orderBy(asc(windows.startDate)),
		db.select({ m: max(books.sortOrder) }).from(books).where(eq(books.seriesId, seriesId)),
	]);
	const ser = serRows[0];
	if (!ser) throw error(404, 'Series not found');
	if (clash.length) throw error(409, `Another book in this series already uses the code ${input.code}.`);
	const stagesOfTrack = trackStageRows.map((x) => x.s);
	if (!stagesOfTrack.length) throw error(400, 'Choose a track with at least one stage.');
	const stageById = new Map(stagesOfTrack.map((s) => [s.id, s]));

	const bookId = ulid();
	const now = new Date().toISOString();
	const newTasks: NewTask[] = [];
	let skipIds: string[];

	if ('likeBookId' in input.schedule) {
		const like = await db.select().from(books).where(eq(books.id, input.schedule.likeBookId)).then((r) => r[0]);
		if (!like || like.seriesId !== seriesId || like.archivedAt) throw error(400, 'Choose a book in this series to copy.');
		if (like.trackId !== input.trackId) throw error(400, `${like.code} is on another track; copy a book from the same track.`);

		skipIds = await db.select({ id: bookStageSkips.stageId }).from(bookStageSkips)
			.where(eq(bookStageSkips.bookId, like.id)).then((r) => r.map((x) => x.id).filter((id) => stageById.has(id)));
		const likeTasks = await db.select().from(tasks).where(eq(tasks.bookId, like.id));
		const likeAssignees = likeTasks.length
			? await db.select().from(taskAssignees).where(inArray(taskAssignees.taskId, likeTasks.map((t) => t.id)))
			: [];
		for (const t of likeTasks) {
			if (!stageById.has(t.stageId) || skipIds.includes(t.stageId)) continue;
			newTasks.push({
				id: ulid(), bookId, stageId: t.stageId, windowId: t.windowId, scheduleState: t.scheduleState,
				overflowAllowed: t.overflowAllowed, title: t.title, startDate: t.startDate, endDate: t.endDate,
				durationDays: t.durationDays, status: 'not_started', createdAt: now, updatedAt: now,
				assignees: likeAssignees.filter((a) => a.taskId === t.id).map((a) => ({ personId: a.personId, isLead: a.isLead })),
			});
		}
	} else {
		skipIds = (input.schedule.skipStageIds ?? []).filter((id) => stageById.has(id));
		const fromDate = toWorkingDay(input.schedule.fromDate ?? nextWorkingDay(opts.today));
		const present = stagesOfTrack.filter((s) => !skipIds.includes(s.id));
		const links = bookLinks(new Set(present.map((s) => s.id)), pattern);

		// Chain from the date: each task starts once its predecessors allow, never before
		// the date, and is placed in windows like a slip.
		const rules: WindowRules = { enforce: !!ser.enforceWindows, windows: wins, overflowDays: ser.windowOverflowDays };
		const idOf = new Map(present.map((s) => [s.id, ulid()]));
		const deps = links.map((l) => ({ predecessorId: idOf.get(l.from)!, successorId: idOf.get(l.to)!, lagDays: l.lagDays }));
		const { predMap } = buildPredMap(deps);
		const taskMap = new Map<string, SchedTask>();
		const order = topoStages(present, links);
		for (const s of order) {
			const id = idOf.get(s.id)!;
			const draft: SchedTask = {
				id, startDate: fromDate, endDate: deriveEnd(fromDate, s.defaultDays), durationDays: s.defaultDays, status: 'not_started',
				windowId: null, scheduleState: 'scheduled', ignoresWindows: !!s.ignoresWindows, version: 1,
			};
			taskMap.set(id, draft);
			const earliest = earliestStart(id, taskMap, predMap);
			const placed = settle(draft, earliest && earliest > fromDate ? earliest : fromDate, rules);
			taskMap.set(id, { ...draft, ...placed });
			newTasks.push({
				id, bookId, stageId: s.id, windowId: placed.windowId, scheduleState: placed.scheduleState ?? 'scheduled',
				title: s.name, startDate: placed.startDate, endDate: placed.endDate, durationDays: s.defaultDays,
				status: 'not_started', createdAt: now, updatedAt: now, assignees: [],
			});
		}
	}

	// Dependencies from the series pattern, bridging the book's skipped stages.
	const taskOfStage = new Map(newTasks.map((t) => [t.stageId, t.id!]));
	const depRows = bookLinks(new Set(taskOfStage.keys()), pattern)
		.map((l) => ({ id: ulid(), predecessorId: taskOfStage.get(l.from)!, successorId: taskOfStage.get(l.to)!, lagDays: l.lagDays }));

	const sortOrder = (maxSort[0]?.m ?? 0) + 1;
	const book = {
		id: bookId, seriesId, trackId: input.trackId, code: input.code, name: input.name,
		groupLabel: input.groupLabel ?? null, batch: input.batch ?? null, sortOrder,
	};

	const winLabel = new Map(wins.map((w) => [w.id, w.label]));
	const report = {
		book,
		tasks: [...newTasks]
			.sort((a, b) => a.startDate.localeCompare(b.startDate))
			.map((t) => ({
				stage: stageById.get(t.stageId)?.name ?? '', startDate: t.startDate, endDate: t.endDate,
				window: t.windowId ? winLabel.get(t.windowId) ?? null : null, scheduleState: t.scheduleState,
				assignees: t.assignees.length,
			})),
		skips: skipIds.map((id) => stageById.get(id)?.name ?? id),
		dependencies: depRows.length,
		late: newTasks.filter((t) => t.endDate < opts.today).length,
	};
	if (opts.preview) return { preview: true as const, ...report };

	const batchId = ulid();
	// One round trip for the whole book, all or nothing.
	// Drizzle writes only the table's columns, so the assignees list on each task is ignored.
	const assigneeRows = newTasks.flatMap((t) => t.assignees.map((a) => ({ taskId: t.id!, ...a })));
	await writeAll([
		db.insert(books).values(book),
		...(skipIds.length ? [db.insert(bookStageSkips).values(skipIds.map((stageId) => ({ bookId, stageId })))] : []),
		...(newTasks.length ? [db.insert(tasks).values(newTasks)] : []),
		...(assigneeRows.length ? [db.insert(taskAssignees).values(assigneeRows)] : []),
		...(depRows.length ? [db.insert(dependencies).values(depRows)] : []),
		db.insert(printRecords).values({ bookId, copiesPlanned: ser.defaultCopies, depositCopies: ser.legalDepositCopies, updatedAt: now }),
		db.insert(activityLog).values({
			id: ulid(), seriesId, actorId, entity: 'book', entityId: bookId, action: 'create',
			afterJson: JSON.stringify({ ...book, schedule: input.schedule, tasks: newTasks.length, skips: skipIds }),
			batchId, createdAt: now,
		}),
	]);

	return { preview: false as const, ...report, batchId };
}

/** Stages ordered so every pattern predecessor comes first; ties keep matrix order. */
function topoStages(present: StageRow[], links: StageLink[]): StageRow[] {
	const indeg = new Map(present.map((s) => [s.id, 0]));
	for (const l of links) indeg.set(l.to, (indeg.get(l.to) ?? 0) + 1);
	const out: StageRow[] = [];
	const done = new Set<string>();
	while (out.length < present.length) {
		const next = present.find((s) => !done.has(s.id) && indeg.get(s.id) === 0)
			?? present.find((s) => !done.has(s.id))!; // a cycle in the pattern would be a bug; never stall
		done.add(next.id);
		out.push(next);
		for (const l of links) if (l.from === next.id) indeg.set(l.to, (indeg.get(l.to) ?? 0) - 1);
	}
	return out;
}
