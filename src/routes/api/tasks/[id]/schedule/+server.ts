import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { ulid } from 'ulid';
import { writeAll } from '#lib/server/db/index.ts';
import { requireCoord, parseBody, versionConflict, loadTaskWithSeries } from '#lib/server/api-auth.ts';
import { checkExplicitMove, deriveEnd, propagate } from '#lib/server/scheduler.ts';
import { loadSeriesContext, projectedFinish } from '#lib/server/series-context.ts';
import { taskChangeQueries, type TaskChange } from '#lib/server/schedule-write.ts';

type Body = {
	start: string;
	durationDays: number;
	/** Ignored under enforced windows: a task belongs to the window it starts in. */
	windowId?: string | null;
	version: number;
};

// POST /api/tasks/:id/schedule — move or resize one task, then push its successors.
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { id } = params;
	const body = await parseBody<Body>(request);

	const { task, seriesId } = await loadTaskWithSeries(id);
	if (task.version !== body.version) return versionConflict(task);

	const { personId } = await requireCoord(locals, seriesId);

	const ctx = await loadSeriesContext(seriesId);
	const original = new Map([...ctx.taskMap].map(([k, v]) => [k, { ...v }]));
	const orig = ctx.taskMap.get(id)!;

	const moved = { ...orig, startDate: body.start, endDate: deriveEnd(body.start, body.durationDays), durationDays: body.durationDays };
	const check = checkExplicitMove(moved, ctx.rules);
	if (!check.ok) {
		return json({ error: 'window_violation', taskIds: [id], message: `This task ${check.reason}.` }, { status: 422 });
	}
	ctx.taskMap.set(id, { ...moved, windowId: check.windowId, scheduleState: 'scheduled' });

	const pushed = propagate(new Set([id]), ctx.taskMap, ctx.depList, ctx.rules);

	const changes: TaskChange[] = [
		{
			id, startDate: moved.startDate, endDate: moved.endDate, durationDays: moved.durationDays,
			windowId: check.windowId, scheduleState: 'scheduled',
			action: body.durationDays !== orig.durationDays ? 'resize' : 'move',
		},
		...[...pushed].map(([tid, p]) => ({
			id: tid, ...p, windowId: p.windowId ?? null,
			action: p.scheduleState === 'unscheduled' ? 'unschedule' : 'move',
		})),
	];

	const batchId = ulid();
	const now = new Date().toISOString();
	// One round trip for every task written and its log entry.
	const { queries, written: changed } = taskChangeQueries({ seriesId, actorId: personId, batchId, now, original, changes });
	await writeAll(queries);

	return json({ changed, batchId, projectedFinish: projectedFinish(ctx.taskMap, ctx.finishTaskIds) });
};
