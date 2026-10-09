import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { ulid } from 'ulid';
import { db } from '#lib/server/db/index.ts';
import { tasks, taskAssignees, activityLog, seriesMembers } from '#lib/server/db/schema.ts';
import { and, eq, inArray } from 'drizzle-orm';
import { requireCoord, parseBody, versionConflict, loadTaskWithSeries } from '#lib/server/api-auth.ts';
import { assigneesSchema, parseOr400 } from '#lib/server/validation.ts';

// POST /api/tasks/:id/assignees { personIds, leadId?, version } — replace a task's assignees
// (spec: Task drawer). Everyone must be a member of the series; the lead must be one of them,
// and defaults to the first. An empty list leaves the task unassigned.
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

	const before = await db.select().from(taskAssignees).where(eq(taskAssignees.taskId, id));
	const now = new Date().toISOString();

	await db.transaction(async (tx) => {
		await tx.delete(taskAssignees).where(eq(taskAssignees.taskId, id));
		if (personIds.length)
			await tx.insert(taskAssignees).values(personIds.map((pid) => ({ taskId: id, personId: pid, isLead: pid === leadId ? 1 : 0 })));
		await tx.update(tasks).set({ version: task.version + 1, updatedAt: now }).where(eq(tasks.id, id));
		await tx.insert(activityLog).values({
			id: ulid(), seriesId, actorId: personId, entity: 'task', entityId: id, action: 'reassign',
			beforeJson: JSON.stringify({ personIds: before.map((a) => a.personId), leadId: before.find((a) => a.isLead)?.personId ?? null, version: task.version }),
			afterJson: JSON.stringify({ personIds, leadId, version: task.version + 1 }),
			createdAt: now,
		});
	});

	const updated = await db.select().from(tasks).where(eq(tasks.id, id)).then((r) => r[0]);
	const assignees = await db.select().from(taskAssignees).where(eq(taskAssignees.taskId, id));
	return json({ task: updated, assignees });
};
