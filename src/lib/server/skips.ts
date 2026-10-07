/**
 * Skipping a stage for one book, and lifting a skip (spec: Pipeline changes). A skip is
 * recorded as data, not just a missing task, so later structural changes never recreate
 * the task. Both are previewed, then saved as one undoable batch.
 */
import { error } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import { ulid } from 'ulid';
import { db } from '#lib/server/db/index.ts';
import { activityLog, bookStageSkips, books, dependencies, stageTracks, stages, taskAssignees, tasks } from '#lib/server/db/schema.ts';
import { bookLinks } from '../schedule/pattern.ts';
import { deriveEnd, toWorkingDay } from '../schedule/calendar.ts';
import { buildPredMap, earliestStart, propagate, settle, type SchedTask } from './scheduler.ts';
import { loadSeriesContext } from './series-context.ts';
import { writeTaskChanges } from './schedule-write.ts';
import { seriesPattern } from './pipeline-structure.ts';

type Dep = typeof dependencies.$inferSelect;

const STARTED = ['in_progress', 'in_review', 'returned'];
const isStarted = (t: { status: string; statusBeforeBlock: string | null }) =>
	STARTED.includes(t.status) || (t.status === 'blocked' && STARTED.includes(t.statusBeforeBlock ?? ''));

async function loadBookStage(bookId: string, stageId: string) {
	const book = await db.select().from(books).where(eq(books.id, bookId)).then((r) => r[0]);
	if (!book || book.archivedAt) throw error(404, 'Book not found');
	const stage = await db.select().from(stages).where(eq(stages.id, stageId)).then((r) => r[0]);
	if (!stage || stage.seriesId !== book.seriesId || stage.archivedAt) throw error(404, 'Stage not found');
	const inTrack = await db.select().from(stageTracks).where(and(eq(stageTracks.stageId, stageId), eq(stageTracks.trackId, book.trackId)));
	if (!inTrack.length) throw error(400, `${stage.name} is not part of the track ${book.code} follows.`);
	return { book, stage };
}

/** Whether `to` is reachable from `from` over the dependencies. */
function reachable(deps: Pick<Dep, 'predecessorId' | 'successorId'>[], from: string, to: string) {
	const queue = [from];
	const seen = new Set<string>();
	while (queue.length) {
		const cur = queue.shift()!;
		if (cur === to) return true;
		if (seen.has(cur)) continue;
		seen.add(cur);
		for (const d of deps) if (d.predecessorId === cur) queue.push(d.successorId);
	}
	return false;
}

function logger(seriesId: string, actorId: string, batchId: string, now: string) {
	return (entity: 'skip' | 'task' | 'dependency', entityId: string, action: string, before: unknown, after: unknown) => ({
		id: ulid(), seriesId, actorId, entity, entityId, action,
		beforeJson: before ? JSON.stringify(before) : null,
		afterJson: after ? JSON.stringify(after) : null,
		batchId, createdAt: now,
	});
}

/**
 * Skip a stage for a book. Its not-started task is deleted and its dependencies relinked
 * around it (each predecessor to each successor, unless already ordered). Refused if the
 * task has started or is Done.
 */
export async function skipStage(opts: { bookId: string; stageId: string; actorId: string; preview: boolean }) {
	const { book, stage } = await loadBookStage(opts.bookId, opts.stageId);
	const already = await db.select().from(bookStageSkips).where(and(eq(bookStageSkips.bookId, book.id), eq(bookStageSkips.stageId, stage.id)));
	if (already.length) throw error(409, `${book.code} already skips ${stage.name}.`);

	const task = await db.select().from(tasks).where(and(eq(tasks.bookId, book.id), eq(tasks.stageId, stage.id))).then((r) => r[0] ?? null);
	if (task?.status === 'done') throw error(409, `${stage.name} for ${book.code} is Done, so it cannot be skipped.`);
	if (task && isStarted(task)) throw error(409, `${stage.name} for ${book.code} has started. Reset it to Not started before skipping it.`);

	const ctx = await loadSeriesContext(book.seriesId);
	const allDeps: Dep[] = ctx.taskMap.size
		? await db.select().from(dependencies).where(inArray(dependencies.successorId, [...ctx.taskMap.keys()]))
		: [];
	const into = task ? allDeps.filter((d) => d.successorId === task.id) : [];
	const outOf = task ? allDeps.filter((d) => d.predecessorId === task.id) : [];
	const remaining: Pick<Dep, 'predecessorId' | 'successorId'>[] = allDeps.filter((d) => d.predecessorId !== task?.id && d.successorId !== task?.id);
	const bridges: Dep[] = [];
	for (const p of into)
		for (const s of outOf)
			if (!reachable([...remaining, ...bridges], p.predecessorId, s.successorId))
				bridges.push({ id: ulid(), predecessorId: p.predecessorId, successorId: s.successorId, lagDays: p.lagDays + s.lagDays });

	const report = { book: book.code, stage: stage.name, deletesTask: !!task, relinked: bridges.length };
	if (opts.preview) return { preview: true as const, ...report };

	const assignees = task ? await db.select().from(taskAssignees).where(eq(taskAssignees.taskId, task.id)) : [];
	const batchId = ulid();
	const log = logger(book.seriesId, opts.actorId, batchId, new Date().toISOString());

	await db.transaction(async (tx) => {
		await tx.insert(bookStageSkips).values({ bookId: book.id, stageId: stage.id });
		await tx.insert(activityLog).values(log('skip', `${book.id}:${stage.id}`, 'create', null, { bookId: book.id, stageId: stage.id }));
		if (!task) return;
		const touching = [...into, ...outOf];
		if (touching.length) await tx.delete(dependencies).where(inArray(dependencies.id, touching.map((d) => d.id)));
		await tx.delete(taskAssignees).where(eq(taskAssignees.taskId, task.id));
		await tx.delete(tasks).where(eq(tasks.id, task.id));
		await tx.insert(activityLog).values(log('task', task.id, 'delete', { task, assignees, dependencies: touching }, null));
		for (const b of bridges) {
			await tx.insert(dependencies).values(b);
			await tx.insert(activityLog).values(log('dependency', b.id, 'create', null, b));
		}
	});
	return { preview: false as const, ...report, batchId };
}

/**
 * Lift a skip: the stage's task is created again after its predecessors (never before
 * today), linked by the series' dependency pattern, and its successors are pushed as
 * usual. A direct link the skip had bridged is replaced by the route through the task.
 */
export async function liftSkip(opts: { bookId: string; stageId: string; actorId: string; preview: boolean; today: string }) {
	const { book, stage } = await loadBookStage(opts.bookId, opts.stageId);
	const skip = await db.select().from(bookStageSkips).where(and(eq(bookStageSkips.bookId, book.id), eq(bookStageSkips.stageId, stage.id)));
	if (!skip.length) throw error(409, `${book.code} does not skip ${stage.name}.`);

	const ctx = await loadSeriesContext(book.seriesId);
	const original = new Map([...ctx.taskMap].map(([k, v]) => [k, { ...v }]));
	const bookTasks = ctx.tasksData.filter((t) => t.bookId === book.id);
	const newId = ulid();
	const taskOfStage = new Map(bookTasks.map((t) => [t.stageId, t.id]));
	taskOfStage.set(stage.id, newId);

	const wanted: Dep[] = bookLinks(new Set(taskOfStage.keys()), await seriesPattern(book.seriesId))
		.filter((l) => l.from === stage.id || l.to === stage.id)
		.map((l) => ({ id: ulid(), predecessorId: taskOfStage.get(l.from)!, successorId: taskOfStage.get(l.to)!, lagDays: l.lagDays }));

	// Links the skip had bridged: a predecessor of the new task straight to one of its successors.
	const preds = wanted.filter((d) => d.successorId === newId).map((d) => d.predecessorId);
	const succs = wanted.filter((d) => d.predecessorId === newId).map((d) => d.successorId);
	const bridged: Dep[] = bookTasks.length
		? (await db.select().from(dependencies).where(inArray(dependencies.successorId, bookTasks.map((t) => t.id))))
			.filter((d) => preds.includes(d.predecessorId) && succs.includes(d.successorId))
		: [];

	const deps = [
		...ctx.depList.filter((d) => !bridged.some((b) => b.predecessorId === d.predecessorId && b.successorId === d.successorId)),
		...wanted,
	];
	const start = toWorkingDay(opts.today);
	const draft: SchedTask = {
		id: newId, startDate: start, endDate: deriveEnd(start, stage.defaultDays), durationDays: stage.defaultDays,
		status: 'not_started', windowId: null, scheduleState: 'scheduled', ignoresWindows: !!stage.ignoresWindows, version: 1,
	};
	ctx.taskMap.set(newId, draft);
	const earliest = earliestStart(newId, ctx.taskMap, buildPredMap(deps).predMap);
	const placed = settle(draft, earliest && earliest > start ? earliest : start, ctx.rules);
	ctx.taskMap.set(newId, { ...draft, ...placed });
	const pushed = propagate(new Set([newId]), ctx.taskMap, deps, ctx.rules);

	const winLabel = new Map(ctx.windows.map((w) => [w.id, w.label]));
	const report = {
		book: book.code,
		stage: stage.name,
		task: {
			startDate: placed.startDate, endDate: placed.endDate, scheduleState: placed.scheduleState,
			window: placed.windowId ? winLabel.get(placed.windowId) ?? null : null,
		},
		linked: wanted.length,
		unlinked: bridged.length,
		pushed: [...pushed].map(([id, p]) => ({ label: ctx.labels.get(id) ?? id, from: original.get(id)!.startDate, to: p.startDate, scheduleState: p.scheduleState })),
	};
	if (opts.preview) return { preview: true as const, ...report };

	const batchId = ulid();
	const now = new Date().toISOString();
	const log = logger(book.seriesId, opts.actorId, batchId, now);
	const newTask = {
		id: newId, bookId: book.id, stageId: stage.id, windowId: placed.windowId, scheduleState: placed.scheduleState ?? 'scheduled',
		title: stage.name, startDate: placed.startDate, endDate: placed.endDate, durationDays: stage.defaultDays,
		status: 'not_started' as const, createdAt: now, updatedAt: now,
	};

	await db.transaction(async (tx) => {
		await tx.delete(bookStageSkips).where(and(eq(bookStageSkips.bookId, book.id), eq(bookStageSkips.stageId, stage.id)));
		await tx.insert(activityLog).values(log('skip', `${book.id}:${stage.id}`, 'delete', { bookId: book.id, stageId: stage.id }, null));
		await tx.insert(tasks).values(newTask);
		await tx.insert(activityLog).values(log('task', newId, 'create', null, newTask));
		for (const b of bridged) {
			await tx.delete(dependencies).where(eq(dependencies.id, b.id));
			await tx.insert(activityLog).values(log('dependency', b.id, 'delete', b, null));
		}
		for (const d of wanted) {
			await tx.insert(dependencies).values(d);
			await tx.insert(activityLog).values(log('dependency', d.id, 'create', null, d));
		}
		await writeTaskChanges(tx, {
			seriesId: book.seriesId, actorId: opts.actorId, batchId, now, original,
			changes: [...pushed].map(([id, p]) => ({ id, ...p, windowId: p.windowId ?? null, action: p.scheduleState === 'unscheduled' ? 'unschedule' : 'move' })),
		});
	});
	return { preview: false as const, ...report, batchId };
}
