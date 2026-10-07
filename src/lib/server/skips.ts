/**
 * Skipping a stage for one book, and lifting a skip (spec: Pipeline changes). A skip is
 * recorded as data, not just a missing task, so later structural changes never recreate
 * the task. Both are previewed, then saved as one undoable batch.
 */
import { error } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import { ulid } from 'ulid';
import { db } from '#lib/server/db/index.ts';
import { activityLog, bookStageSkips, books, dependencies, stageTracks, stages, tasks } from '#lib/server/db/schema.ts';
import { planRelink } from '../schedule/relink.ts';
import { loadSeriesContext } from './series-context.ts';
import { planNewTasks, writePlan } from './stage-tasks.ts';
import { seriesPattern } from './pipeline-structure.ts';
import { deleteTasks, isStarted, logger } from './removal.ts';

type Dep = typeof dependencies.$inferSelect;

async function loadBookStage(bookId: string, stageId: string) {
	const book = await db.select().from(books).where(eq(books.id, bookId)).then((r) => r[0]);
	if (!book || book.archivedAt) throw error(404, 'Book not found');
	const stage = await db.select().from(stages).where(eq(stages.id, stageId)).then((r) => r[0]);
	if (!stage || stage.seriesId !== book.seriesId || stage.archivedAt) throw error(404, 'Stage not found');
	const inTrack = await db.select().from(stageTracks).where(and(eq(stageTracks.stageId, stageId), eq(stageTracks.trackId, book.trackId)));
	if (!inTrack.length) throw error(400, `${stage.name} is not part of the track ${book.code} follows.`);
	return { book, stage };
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
	const { touching, bridges } = task ? planRelink(new Set([task.id]), allDeps, ulid) : { touching: [], bridges: [] };

	const report = { book: book.code, stage: stage.name, deletesTask: !!task, relinked: bridges.length };
	if (opts.preview) return { preview: true as const, ...report };

	const batchId = ulid();
	const log = logger(book.seriesId, opts.actorId, batchId, new Date().toISOString());

	await db.transaction(async (tx) => {
		await tx.insert(bookStageSkips).values({ bookId: book.id, stageId: stage.id });
		await tx.insert(activityLog).values(log('skip', `${book.id}:${stage.id}`, 'create', null, { bookId: book.id, stageId: stage.id }));
		if (task) await deleteTasks(tx, log, [task], touching, bridges);
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
	const deps: Dep[] = ctx.taskMap.size
		? await db.select().from(dependencies).where(inArray(dependencies.successorId, [...ctx.taskMap.keys()]))
		: [];
	const plan = planNewTasks({ ctx, deps, gains: [{ bookId: book.id, stages: [stage] }], pattern: await seriesPattern(book.seriesId), today: opts.today });
	const task = plan.newTasks[0];
	const winLabel = new Map(ctx.windows.map((w) => [w.id, w.label]));
	const report = {
		book: book.code,
		stage: stage.name,
		task: {
			startDate: task.startDate, endDate: task.endDate, scheduleState: task.scheduleState,
			window: task.windowId ? winLabel.get(task.windowId) ?? null : null,
		},
		linked: plan.links.length,
		unlinked: plan.unlinked.length,
		pushed: [...plan.pushed].map(([id, p]) => ({ label: ctx.labels.get(id) ?? id, from: original.get(id)!.startDate, to: p.startDate, scheduleState: p.scheduleState })),
	};
	if (opts.preview) return { preview: true as const, ...report };

	const batchId = ulid();
	const now = new Date().toISOString();
	const log = logger(book.seriesId, opts.actorId, batchId, now);
	await db.transaction(async (tx) => {
		await tx.delete(bookStageSkips).where(and(eq(bookStageSkips.bookId, book.id), eq(bookStageSkips.stageId, stage.id)));
		await tx.insert(activityLog).values(log('skip', `${book.id}:${stage.id}`, 'delete', { bookId: book.id, stageId: stage.id }, null));
		await writePlan(tx, plan, { seriesId: book.seriesId, actorId: opts.actorId, batchId, now, log, original });
	});
	return { preview: false as const, ...report, batchId };
}
