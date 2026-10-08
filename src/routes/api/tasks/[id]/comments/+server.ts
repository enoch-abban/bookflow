import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { ulid } from 'ulid';
import { db } from '#lib/server/db/index.ts';
import { activityLog, taskComments } from '#lib/server/db/schema.ts';
import { loadTaskWithSeries, parseBody, requireMember } from '#lib/server/api-auth.ts';
import { commentSchema, parseOr400 } from '#lib/server/validation.ts';

// POST /api/tasks/:id/comments — any series member can comment on any task.
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { task, seriesId } = await loadTaskWithSeries(params.id);
	const { personId } = await requireMember(locals, seriesId);
	const { body } = parseOr400(commentSchema, await parseBody(request));
	const comment = { id: ulid(), taskId: task.id, authorId: personId, body, createdAt: new Date().toISOString() };
	await db.transaction(async (tx) => {
		await tx.insert(taskComments).values(comment);
		await tx.insert(activityLog).values({
			id: ulid(), seriesId, actorId: personId, entity: 'comment', entityId: comment.id, action: 'create',
			afterJson: JSON.stringify({ taskId: task.id }), createdAt: comment.createdAt,
		});
	});
	return json({ comment }, { status: 201 });
};
