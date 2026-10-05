import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { ulid } from 'ulid';
import { db } from '#lib/server/db/index.ts';
import { tasks, books, activityLog } from '#lib/server/db/schema.ts';
import { eq, inArray } from 'drizzle-orm';
import { requireCoord, parseBody } from '#lib/server/api-auth.ts';
import { propagate, deriveEnd } from '#lib/server/scheduler.ts';
import { loadSeriesContext } from '#lib/server/series-context.ts';

type Move = {
	id: string;
	start: string;
	durationDays: number;
	windowId?: string | null;
	version: number;
};

type Body = { moves: Move[] };

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

	// Load full context
	const { taskMap, depList } = await loadSeriesContext(seriesId);

	// Apply all moves to in-memory map
	for (const move of body.moves) {
		const t = taskMap.get(move.id);
		if (!t) continue;
		taskMap.set(move.id, {
			...t,
			startDate:    move.start,
			endDate:      deriveEnd(move.start, move.durationDays),
			durationDays: move.durationDays,
		});
	}

	// Propagate from all moved tasks
	const pushed = propagate(new Set(taskIds), taskMap, depList);

	const batchId = ulid();
	const now     = new Date().toISOString();

	// Build full change set
	const allChanges = new Map<string, { startDate: string; endDate: string; durationDays?: number; windowId?: string | null }>();
	for (const move of body.moves) {
		allChanges.set(move.id, {
			startDate:    move.start,
			endDate:      deriveEnd(move.start, move.durationDays),
			durationDays: move.durationDays,
			windowId:     move.windowId,
		});
	}
	for (const [tid, dates] of pushed) {
		if (!allChanges.has(tid)) allChanges.set(tid, dates);
	}

	// Persist
	await db.transaction(async tx => {
		for (const [tid, change] of allChanges) {
			const orig = taskMap.get(tid)!;
			await tx.update(tasks).set({
				startDate:    change.startDate,
				endDate:      change.endDate,
				...(change.durationDays !== undefined ? { durationDays: change.durationDays } : {}),
				...(change.windowId !== undefined     ? { windowId: change.windowId }         : {}),
				version:      orig.version + 1,
				updatedAt:    now,
			}).where(eq(tasks.id, tid));

			await tx.insert(activityLog).values({
				id:         ulid(),
				seriesId,
				actorId:    personId,
				entity:     'task',
				entityId:   tid,
				action:     taskIds.includes(tid) ? 'move' : 'move',
				beforeJson: JSON.stringify({ startDate: orig.startDate, endDate: orig.endDate, version: orig.version }),
				afterJson:  JSON.stringify({ startDate: change.startDate, endDate: change.endDate, version: orig.version + 1 }),
				batchId,
				createdAt:  now,
			});
		}
	});

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
