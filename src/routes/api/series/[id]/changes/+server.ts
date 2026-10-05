import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { activityLog, tasks } from '#lib/server/db/schema.ts';
import { and, eq, gt, inArray } from 'drizzle-orm';
import { requireMember } from '#lib/server/api-auth.ts';

// GET /api/series/:id/changes?since=<cursor>
// Returns tasks changed since the cursor ULID, plus a new cursor.
// Used by the swimlane for 10-second polling.
export const GET: RequestHandler = async ({ params, url, locals }) => {
	const { id: seriesId } = params;
	await requireMember(locals, seriesId);

	const since  = url.searchParams.get('since') ?? '0';

	// Activity log entries since the cursor, for this series
	const entries = await db.select()
		.from(activityLog)
		.where(and(
			eq(activityLog.seriesId, seriesId),
			gt(activityLog.id, since)
		))
		.orderBy(activityLog.id)
		.limit(200);

	if (!entries.length) {
		return json({ tasks: [], cursor: since });
	}

	// Collect unique task IDs that changed
	const taskIds = [...new Set(entries.filter(e => e.entity === 'task').map(e => e.entityId))];

	const changedTasks = taskIds.length
		? await db.select().from(tasks).where(inArray(tasks.id, taskIds))
		: [];

	const cursor = entries[entries.length - 1].id;

	return json({ tasks: changedTasks, cursor });
};
