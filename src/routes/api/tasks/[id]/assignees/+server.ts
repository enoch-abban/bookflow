import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { ulid } from 'ulid';
import { db } from '#lib/server/db/index.ts';
import { tasks, taskAssignees, activityLog } from '#lib/server/db/schema.ts';
import { eq } from 'drizzle-orm';
import { requireCoord, parseBody, versionConflict, loadTaskWithSeries } from '#lib/server/api-auth.ts';

type Body = { personIds: string[]; leadId: string; version: number };

// POST /api/tasks/:id/assignees
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { id } = params;
	const body = await parseBody<Body>(request);

	const { task, seriesId } = await loadTaskWithSeries(id);
	if (task.version !== body.version) return versionConflict(task);

	const { personId } = await requireCoord(locals, seriesId);

	const now = new Date().toISOString();

	await db.transaction(async tx => {
		// Replace all assignees
		await tx.delete(taskAssignees).where(eq(taskAssignees.taskId, id));

		for (const pid of body.personIds) {
			await tx.insert(taskAssignees).values({
				taskId:   id,
				personId: pid,
				isLead:   pid === body.leadId ? 1 : 0,
			});
		}

		await tx.update(tasks).set({ version: task.version + 1, updatedAt: now }).where(eq(tasks.id, id));

		await tx.insert(activityLog).values({
			id:        ulid(),
			seriesId,
			actorId:   personId,
			entity:    'task',
			entityId:  id,
			action:    'reassign',
			afterJson: JSON.stringify({ personIds: body.personIds, leadId: body.leadId }),
			createdAt: now,
		});
	});

	const updated = await db.select().from(tasks).where(eq(tasks.id, id)).then(r => r[0]);
	const assignees = await db.select().from(taskAssignees).where(eq(taskAssignees.taskId, id));
	return json({ task: updated, assignees });
};
