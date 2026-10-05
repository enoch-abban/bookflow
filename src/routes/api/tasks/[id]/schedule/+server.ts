import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { ulid } from 'ulid';
import { db } from '#lib/server/db/index.ts';
import { tasks, activityLog } from '#lib/server/db/schema.ts';
import { eq } from 'drizzle-orm';
import { requireCoord, parseBody, versionConflict, loadTaskWithSeries } from '#lib/server/api-auth.ts';
import { propagate, deriveEnd } from '#lib/server/scheduler.ts';
import { loadSeriesContext } from '#lib/server/series-context.ts';

type Body = {
	start: string;
	durationDays: number;
	windowId?: string | null;
	version: number;
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { id } = params;
	const body = await parseBody<Body>(request);

	const { task, seriesId } = await loadTaskWithSeries(id);
	if (task.version !== body.version) return versionConflict(task);

	const { personId } = await requireCoord(locals, seriesId);

	// Compute new dates
	const newStart = body.start;
	const newEnd   = deriveEnd(newStart, body.durationDays);

	// Load full series context for propagation
	const { taskMap, depList } = await loadSeriesContext(seriesId);

	// Apply move to in-memory map
	taskMap.set(id, { ...taskMap.get(id)!, startDate: newStart, endDate: newEnd, durationDays: body.durationDays });

	// Propagate
	const pushed = propagate(new Set([id]), taskMap, depList);

	// Build full change set
	const batchId = ulid();
	const now     = new Date().toISOString();

	const allChanges = new Map<string, { startDate: string; endDate: string; durationDays?: number }>();
	allChanges.set(id, { startDate: newStart, endDate: newEnd, durationDays: body.durationDays });
	for (const [tid, dates] of pushed) allChanges.set(tid, dates);

	// Persist in transaction
	await db.transaction(async tx => {
		for (const [tid, change] of allChanges) {
			const orig = taskMap.get(tid)!;
			await tx.update(tasks).set({
				startDate:    change.startDate,
				endDate:      change.endDate,
				...(change.durationDays !== undefined ? { durationDays: change.durationDays } : {}),
				...(tid === id && body.windowId !== undefined ? { windowId: body.windowId } : {}),
				version:      orig.version + 1,
				updatedAt:    now,
			}).where(eq(tasks.id, tid));

			await tx.insert(activityLog).values({
				id:         ulid(),
				seriesId,
				actorId:    personId,
				entity:     'task',
				entityId:   tid,
				action:     tid === id ? (body.durationDays !== orig.durationDays ? 'resize' : 'move') : 'move',
				beforeJson: JSON.stringify({ startDate: orig.startDate, endDate: orig.endDate, durationDays: orig.durationDays, windowId: orig.windowId, version: orig.version }),
				afterJson:  JSON.stringify({ startDate: change.startDate, endDate: change.endDate, version: orig.version + 1 }),
				batchId,
				createdAt:  now,
			});
		}
	});

	// Build response: all changed tasks with updated versions
	const changed = [...allChanges.entries()].map(([tid, c]) => {
		const orig = taskMap.get(tid)!;
		return {
			id:           tid,
			startDate:    c.startDate,
			endDate:      c.endDate,
			durationDays: c.durationDays ?? orig.durationDays,
			version:      orig.version + 1,
		};
	});

	return json({ changed, batchId });
};
