/**
 * Task status changes (spec: Task statuses, Print approval gate, Recording ISBNs).
 * Shared by PATCH /api/tasks/:id and the My tasks buttons, so both check the same
 * permission, transition and guard rules, bump the version and log the change.
 */
import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { db } from '#lib/server/db/index.ts';
import { activityLog, books, seriesMembers, stages, taskAssignees, tasks } from '#lib/server/db/schema.ts';
import { isAllowedTransition } from './scheduler.ts';
import { resolvePerson } from './api-auth.ts';
import { reviewGuard } from './reviews.ts';

type TaskRow = typeof tasks.$inferSelect;

/**
 * Stage-specific rules: a gate completes only through its approval action, never a
 * status button, and "ISBN issued" can only be Done once the book has an ISBN.
 */
export async function statusGuard(task: TaskRow, to: string) {
	if (to === task.status) return;
	const stage = await db.select().from(stages).where(eq(stages.id, task.stageId)).then((r) => r[0]);
	if (stage?.category === 'gate')
		throw error(422, `${stage.name} completes only by approving the book for print on its page.`);
	if (stage?.key === 'isbn_issued' && to === 'done') {
		const book = await db.select({ isbn: books.isbn }).from(books).where(eq(books.id, task.bookId)).then((r) => r[0]);
		if (!book?.isbn) throw error(422, 'Record the ISBN on the book page before marking ISBN issued as Done.');
	}
	// Review loop: submit only when a review stage follows; in-review tasks move only by review.
	await reviewGuard(task, to);
}

/** Field changes a status move implies (blocked memory, completion time). Review rounds are counted on Return. */
export function statusUpdates(task: TaskRow, to: string, now: string): Partial<TaskRow> {
	const updates: Partial<TaskRow> = { status: to as TaskRow['status'] };
	if (to === 'blocked') updates.statusBeforeBlock = task.status;
	else if (task.status === 'blocked') {
		updates.statusBeforeBlock = null;
		updates.blockedReason = null;
	}
	if (to === 'done') updates.completedAt = now;
	return updates;
}

/** Change one task's status as the signed-in person (My tasks buttons). */
export async function changeStatus(locals: App.Locals, taskId: string, to: TaskRow['status']) {
	const { personId, isAdmin } = await resolvePerson(locals);
	const row = await db.select({ task: tasks, seriesId: books.seriesId }).from(tasks)
		.innerJoin(books, eq(books.id, tasks.bookId)).where(eq(tasks.id, taskId)).then((r) => r[0]);
	if (!row) throw error(404, 'Task not found');
	const { task, seriesId } = row;

	const member = await db.select({ role: seriesMembers.role }).from(seriesMembers)
		.where(and(eq(seriesMembers.seriesId, seriesId), eq(seriesMembers.personId, personId))).then((r) => r[0]);
	const assigned = await db.select().from(taskAssignees)
		.where(and(eq(taskAssignees.taskId, task.id), eq(taskAssignees.personId, personId))).then((r) => r.length > 0);
	if (!isAdmin && member?.role !== 'coordinator' && !assigned) throw error(403, 'Only the assignees or a coordinator can change this task.');

	if (!isAllowedTransition(task.status, to)) throw error(422, `A task cannot go from ${task.status.replace('_', ' ')} to ${to.replace('_', ' ')}.`);
	await statusGuard(task, to);
	if (to === task.status) return task;

	const now = new Date().toISOString();
	const updates = { ...statusUpdates(task, to, now), version: task.version + 1, updatedAt: now };
	await db.transaction(async (tx) => {
		await tx.update(tasks).set(updates).where(eq(tasks.id, task.id));
		await tx.insert(activityLog).values({
			id: ulid(), seriesId, actorId: personId, entity: 'task', entityId: task.id, action: 'status',
			beforeJson: JSON.stringify({ status: task.status, version: task.version }),
			afterJson: JSON.stringify(updates), createdAt: now,
		});
	});
	return { ...task, ...updates };
}
