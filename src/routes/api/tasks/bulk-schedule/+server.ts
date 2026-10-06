import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { ulid } from 'ulid';
import { db } from '#lib/server/db/index.ts';
import { tasks, books } from '#lib/server/db/schema.ts';
import { inArray } from 'drizzle-orm';
import { requireCoord, parseBody } from '#lib/server/api-auth.ts';
import { checkExplicitMove, deriveEnd, propagate } from '#lib/server/scheduler.ts';
import { loadSeriesContext, projectedFinish } from '#lib/server/series-context.ts';
import { writeTaskChanges, type TaskChange } from '#lib/server/schedule-write.ts';

type Move = {
	id: string;
	start: string;
	durationDays: number;
	/** Ignored under enforced windows: a task belongs to the window it starts in. */
	windowId?: string | null;
	version: number;
};

type Body = { moves: Move[] };

// POST /api/tasks/bulk-schedule — move several tasks together. Every move is checked
// before any is saved; nothing is clamped (spec: Bulk schedule).
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await parseBody<Body>(request);
	if (!body.moves?.length) throw error(400, 'moves array required');

	// All moved tasks must belong to the same series
	const taskIds = body.moves.map(m => m.id);
	const taskRows = await db.select({ id: tasks.id, version: tasks.version, bookId: tasks.bookId })
		.from(tasks)
		.where(inArray(tasks.id, taskIds));

	if (taskRows.length !== taskIds.length) throw error(404, 'One or more tasks not found');

	// Check versions
	const staleConflicts = body.moves.filter(m => {
		const row = taskRows.find(r => r.id === m.id);
		return row && row.version !== m.version;
	});
	if (staleConflicts.length > 0) {
		return json({ error: 'version_conflict', taskIds: staleConflicts.map(m => m.id) }, { status: 409 });
	}

	// Resolve series
	const bookIds = [...new Set(taskRows.map(r => r.bookId))];
	const bookRows = await db.select({ id: books.id, seriesId: books.seriesId })
		.from(books).where(inArray(books.id, bookIds));

	const seriesIds = [...new Set(bookRows.map(b => b.seriesId))];
	if (seriesIds.length !== 1) throw error(400, 'All tasks must belong to the same series');

	const seriesId = seriesIds[0];
	const { personId } = await requireCoord(locals, seriesId);

	const ctx = await loadSeriesContext(seriesId);
	const original = new Map([...ctx.taskMap].map(([k, v]) => [k, { ...v }]));

	// Check every move against its window before saving any.
	const changes: TaskChange[] = [];
	const violations: { id: string; reason: string }[] = [];
	for (const move of body.moves) {
		const t = ctx.taskMap.get(move.id)!;
		const moved = { ...t, startDate: move.start, endDate: deriveEnd(move.start, move.durationDays), durationDays: move.durationDays };
		const check = checkExplicitMove(moved, ctx.rules);
		if (!check.ok) { violations.push({ id: move.id, reason: check.reason }); continue; }
		ctx.taskMap.set(move.id, { ...moved, windowId: check.windowId, scheduleState: 'scheduled' });
		changes.push({
			id: move.id, startDate: moved.startDate, endDate: moved.endDate, durationDays: moved.durationDays,
			windowId: check.windowId, scheduleState: 'scheduled',
			action: move.durationDays !== t.durationDays ? 'resize' : 'move',
		});
	}
	if (violations.length) {
		return json({ error: 'window_violation', taskIds: violations.map(v => v.id), violations }, { status: 422 });
	}

	// One propagation pass from all moved tasks
	const pushed = propagate(new Set(taskIds), ctx.taskMap, ctx.depList, ctx.rules);
	for (const [tid, p] of pushed) {
		if (taskIds.includes(tid)) continue;
		changes.push({ id: tid, ...p, windowId: p.windowId ?? null, action: p.scheduleState === 'unscheduled' ? 'unschedule' : 'move' });
	}

	const batchId = ulid();
	const now = new Date().toISOString();
	const changed = await db.transaction((tx) =>
		writeTaskChanges(tx, { seriesId, actorId: personId, batchId, now, original, changes })
	);

	return json({ changed, batchId, projectedFinish: projectedFinish(ctx.taskMap, ctx.finishTaskIds) });
};
