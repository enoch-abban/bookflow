import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { ulid } from 'ulid';
import { db } from '#lib/server/db/index.ts';
import { dependencies, tasks, books, activityLog } from '#lib/server/db/schema.ts';
import { eq, inArray } from 'drizzle-orm';
import { requireCoord, parseBody } from '#lib/server/api-auth.ts';
import { propagate } from '#lib/server/scheduler.ts';
import { loadSeriesContext } from '#lib/server/series-context.ts';

type Body = { predecessorId: string; successorId: string; lagDays?: number };

// POST /api/dependencies
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await parseBody<Body>(request);
	if (!body.predecessorId || !body.successorId) throw error(400, 'predecessorId and successorId required');
	if (body.predecessorId === body.successorId) throw error(422, 'A task cannot depend on itself');

	// Resolve series from either task
	const taskRows = await db.select({ id: tasks.id, bookId: tasks.bookId })
		.from(tasks).where(inArray(tasks.id, [body.predecessorId, body.successorId]));
	if (taskRows.length !== 2) throw error(404, 'One or both tasks not found');

	const bookIds   = [...new Set(taskRows.map(r => r.bookId))];
	const bookRows  = await db.select({ id: books.id, seriesId: books.seriesId }).from(books).where(inArray(books.id, bookIds));
	const seriesIds = [...new Set(bookRows.map(b => b.seriesId))];
	if (seriesIds.length !== 1) throw error(400, 'Tasks must belong to the same series');

	const seriesId = seriesIds[0];
	const { personId } = await requireCoord(locals, seriesId);

	// Cycle detection: would adding pred→succ create a cycle?
	// BFS from successorId following existing dependencies; if we reach predecessorId, it's a cycle.
	const { depList } = await loadSeriesContext(seriesId);
	const succMap = new Map<string, string[]>();
	for (const d of depList) {
		if (!succMap.has(d.predecessorId)) succMap.set(d.predecessorId, []);
		succMap.get(d.predecessorId)!.push(d.successorId);
	}

	function wouldCycle(from: string, to: string): boolean {
		const visited = new Set<string>();
		const queue = [from];
		while (queue.length) {
			const cur = queue.shift()!;
			if (cur === to) return true;
			if (visited.has(cur)) continue;
			visited.add(cur);
			for (const next of (succMap.get(cur) ?? [])) queue.push(next);
		}
		return false;
	}

	if (wouldCycle(body.successorId, body.predecessorId)) {
		throw error(422, 'Adding this dependency would create a cycle');
	}

	const depId = ulid();
	const now   = new Date().toISOString();
	const lag   = body.lagDays ?? 0;

	// Load full context for post-add propagation
	const { taskMap } = await loadSeriesContext(seriesId);

	// Add the new dep to in-memory list for propagation
	const allDeps = [...depList, { predecessorId: body.predecessorId, successorId: body.successorId, lagDays: lag }];
	const pushed = propagate(new Set([body.predecessorId]), taskMap, allDeps);

	await db.transaction(async tx => {
		await tx.insert(dependencies).values({
			id:            depId,
			predecessorId: body.predecessorId,
			successorId:   body.successorId,
			lagDays:       lag,
		});

		// Apply propagated moves
		for (const [tid, dates] of pushed) {
			const orig = taskMap.get(tid)!;
			await tx.update(tasks).set({
				startDate: dates.startDate,
				endDate:   dates.endDate,
				version:   orig.version + 1,
				updatedAt: now,
			}).where(eq(tasks.id, tid));
		}

		await tx.insert(activityLog).values({
			id:        ulid(),
			seriesId,
			actorId:   personId,
			entity:    'dependency',
			entityId:  depId,
			action:    'create',
			afterJson: JSON.stringify({ predecessorId: body.predecessorId, successorId: body.successorId, lagDays: lag }),
			createdAt: now,
		});
	});

	const dep = await db.select().from(dependencies).where(eq(dependencies.id, depId)).then(r => r[0]);
	const changed = [...pushed.entries()].map(([tid, d]) => ({
		id: tid, ...d, version: (taskMap.get(tid)!.version ?? 0) + 1,
	}));

	return json({ dependency: dep, changed }, { status: 201 });
};
