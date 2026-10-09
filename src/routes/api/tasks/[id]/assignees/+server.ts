import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { ulid } from 'ulid';
import { db, writeAll } from '#lib/server/db/index.ts';
import { tasks, activityLog, seriesMembers } from '#lib/server/db/schema.ts';
import { assignmentQueries, currentAssignment } from '#lib/server/assignees.ts';
import { and, eq, inArray } from 'drizzle-orm';
import { requireCoord, parseBody, versionConflict, loadTaskWithSeries } from '#lib/server/api-auth.ts';
import { assigneesSchema, parseOr400 } from '#lib/server/validation.ts';

// POST /api/tasks/:id/assignees { personIds, leadId?, version } — replace a task's assignees
// (spec: Task drawer). Everyone must be a member of the series; the lead must be one of them,
// and defaults to the first. An empty list leaves the task unassigned. Logged as one batch,
// so the change can be undone like a move.
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { id } = params;
	const body = parseOr400(assigneesSchema, await parseBody(request));

	const { task, seriesId } = await loadTaskWithSeries(id);
	const { personId } = await requireCoord(locals, seriesId);
	if (task.version !== body.version) return versionConflict(task);

	const personIds = [...new Set(body.personIds)];
	if (personIds.length) {
		const members = await db.select({ personId: seriesMembers.personId }).from(seriesMembers)
			.where(and(eq(seriesMembers.seriesId, seriesId), inArray(seriesMembers.personId, personIds)));
		if (members.length !== personIds.length) throw error(422, 'Everyone assigned must be a member of this series.');
	}
	if (body.leadId && !personIds.includes(body.leadId)) throw error(422, 'The lead must be one of the assignees.');
	const leadId = personIds.length ? (body.leadId ?? personIds[0]) : null;

	const before = await currentAssignment(db, id);
	const now = new Date().toISOString();
	const batchId = ulid();

	// One round trip: the assignees, the task's version and the log entry, all or nothing.
	const { assignment: after, queries } = assignmentQueries(id, { personIds, leadId });
	const results = await writeAll([
		...queries,
		db.update(tasks).set({ version: task.version + 1, updatedAt: now }).where(eq(tasks.id, id)).returning(),
		db.insert(activityLog).values({
			id: ulid(), seriesId, actorId: personId, entity: 'task', entityId: id, action: 'reassign',
			beforeJson: JSON.stringify({ ...before, version: task.version }),
			afterJson: JSON.stringify({ ...after, version: task.version + 1 }),
			batchId, createdAt: now,
		}),
	]);
	const updated = (results[queries.length] as (typeof tasks.$inferSelect)[])[0];
	const assignees = after.personIds.map((pid) => ({ taskId: id, personId: pid, isLead: pid === after.leadId ? 1 : 0 }));
	return json({ task: updated, assignees, batchId });
};
