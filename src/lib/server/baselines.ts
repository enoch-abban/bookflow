/**
 * Baselines (spec: Baselines): a frozen copy of planned dates to measure slippage against.
 * Saving one snapshots every scheduled task of the series' live books and stages.
 */
import { error } from '@sveltejs/kit';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { ulid } from 'ulid';
import { db } from '#lib/server/db/index.ts';
import { activityLog, baselines, baselineTasks, books, stages, tasks } from '#lib/server/db/schema.ts';

export async function saveBaseline(opts: { seriesId: string; actorId: string; name: string }) {
	const name = opts.name.trim();
	const taken = await db.select({ id: baselines.id }).from(baselines)
		.where(and(eq(baselines.seriesId, opts.seriesId), eq(baselines.name, name))).then((r) => r.length > 0);
	if (taken) throw error(422, `A baseline called ${name} already exists.`);

	const rows = await db.select({ id: tasks.id, startDate: tasks.startDate, endDate: tasks.endDate })
		.from(tasks)
		.innerJoin(books, eq(books.id, tasks.bookId))
		.innerJoin(stages, eq(stages.id, tasks.stageId))
		.where(and(eq(books.seriesId, opts.seriesId), isNull(books.archivedAt), isNull(stages.archivedAt), eq(tasks.scheduleState, 'scheduled')));
	if (!rows.length) throw error(422, 'There are no scheduled tasks to save yet.');

	const id = ulid();
	const now = new Date().toISOString();
	await db.transaction(async (tx) => {
		await tx.insert(baselines).values({ id, seriesId: opts.seriesId, name, createdAt: now });
		// SQLite caps bound parameters per statement, so insert in chunks.
		for (let i = 0; i < rows.length; i += 200)
			await tx.insert(baselineTasks).values(rows.slice(i, i + 200).map((r) => ({ baselineId: id, taskId: r.id, startDate: r.startDate, endDate: r.endDate })));
		await tx.insert(activityLog).values({
			id: ulid(), seriesId: opts.seriesId, actorId: opts.actorId, entity: 'baseline', entityId: id, action: 'create',
			afterJson: JSON.stringify({ name, tasks: rows.length }), createdAt: now,
		});
	});
	return { id, name, createdAt: now, taskCount: rows.length };
}

/** The suggested name for the next baseline: "Rev 5" is followed by "Rev 6". */
export function nextBaselineName(names: string[]): string {
	const revs = names.map((n) => /^Rev (\d+)$/i.exec(n.trim())?.[1]).filter(Boolean).map(Number);
	return `Rev ${revs.length ? Math.max(...revs) + 1 : names.length + 1}`;
}

/** Baseline rows for a set of tasks, keyed by task id. */
export async function baselineDates(baselineId: string, taskIds: string[]) {
	const out = new Map<string, { startDate: string; endDate: string }>();
	for (let i = 0; i < taskIds.length; i += 500) {
		const part = await db.select().from(baselineTasks)
			.where(and(eq(baselineTasks.baselineId, baselineId), inArray(baselineTasks.taskId, taskIds.slice(i, i + 500))));
		for (const r of part) out.set(r.taskId, { startDate: r.startDate, endDate: r.endDate });
	}
	return out;
}
