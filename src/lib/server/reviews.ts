/**
 * The review loop (spec: Review loop). A work task is reviewed by the assignees of the
 * book's next review-stage task downstream (e.g. InDesign by Post-Layout Review), plus
 * coordinators. Approve completes the task; Return with changes sets it Returned,
 * records a short summary and starts the next round. Review-stage tasks are the reviewing
 * itself, so they have no review step of their own.
 */
import { error, json } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import { ulid } from 'ulid';
import { db } from '#lib/server/db/index.ts';
import { activityLog, books, dependencies, people, reviewCycles, seriesMembers, stages, taskAssignees, tasks } from '#lib/server/db/schema.ts';
import { resolvePerson } from './api-auth.ts';

type TaskRow = typeof tasks.$inferSelect;

/**
 * The review-stage tasks that review `task`: the nearest ones downstream in the same
 * book that are not Done. Empty for review-stage tasks and for work with no review after it.
 */
export async function reviewerTasks(task: Pick<TaskRow, 'id' | 'bookId' | 'stageId'>): Promise<TaskRow[]> {
	const own = await db.select({ t: tasks, isReview: stages.isReview }).from(tasks)
		.innerJoin(stages, eq(stages.id, tasks.stageId)).where(eq(tasks.bookId, task.bookId));
	const byId = new Map(own.map((r) => [r.t.id, r]));
	if (byId.get(task.id)?.isReview) return [];
	const ids = own.map((r) => r.t.id);
	const deps = ids.length ? await db.select().from(dependencies).where(inArray(dependencies.predecessorId, ids)) : [];

	// Breadth-first: the first layer that holds review tasks wins.
	let layer = [task.id];
	const seen = new Set(layer);
	while (layer.length) {
		const next = deps.filter((d) => layer.includes(d.predecessorId) && byId.has(d.successorId) && !seen.has(d.successorId)).map((d) => d.successorId);
		next.forEach((id) => seen.add(id));
		const found = next.map((id) => byId.get(id)!).filter((r) => r.isReview && r.t.status !== 'done');
		if (found.length) return found.map((r) => r.t);
		layer = next;
	}
	return [];
}

/** People who may approve or return `task`: its reviewer tasks' assignees. */
export async function reviewersOf(task: Pick<TaskRow, 'id' | 'bookId' | 'stageId'>) {
	const rt = await reviewerTasks(task);
	if (!rt.length) return { reviewerTasks: rt, people: [] as { id: string; name: string }[] };
	const rows = await db.select({ id: people.id, name: people.displayName }).from(taskAssignees)
		.innerJoin(people, eq(people.id, taskAssignees.personId)).where(inArray(taskAssignees.taskId, rt.map((t) => t.id)));
	return { reviewerTasks: rt, people: [...new Map(rows.map((r) => [r.id, r])).values()] };
}

/** Status rules the review loop adds; shared by the API and My tasks. */
export async function reviewGuard(task: TaskRow, to: string) {
	if (to === task.status) return;
	if (task.status === 'in_review' && (to === 'done' || to === 'returned'))
		throw error(422, 'A task in review is completed or returned by its reviewer: use Approve or Return with changes.');
	const reviewed = (await reviewerTasks(task)).length > 0;
	if (to === 'in_review' && !reviewed) throw error(422, 'No review stage follows this task, so mark it Done instead.');
	if (to === 'done' && task.status === 'in_progress' && reviewed) throw error(422, 'This task needs review: submit it for review instead.');
}

/** Approve or return a task in review, as a reviewer or coordinator. */
export async function recordReview(opts: {
	locals: App.Locals; taskId: string; outcome: 'approved' | 'changes_requested'; summary?: string | null; version?: number;
}) {
	const { personId, isAdmin } = await resolvePerson(opts.locals);
	const row = await db.select({ task: tasks, seriesId: books.seriesId }).from(tasks)
		.innerJoin(books, eq(books.id, tasks.bookId)).where(eq(tasks.id, opts.taskId)).then((r) => r[0]);
	if (!row) throw error(404, 'Task not found');
	const { task, seriesId } = row;
	if (opts.version !== undefined && opts.version !== task.version) return json({ error: 'version_conflict', task }, { status: 409 });
	if (task.status !== 'in_review') throw error(409, 'This task is not waiting for review.');

	const member = await db.select({ role: seriesMembers.role }).from(seriesMembers)
		.where(and(eq(seriesMembers.seriesId, seriesId), eq(seriesMembers.personId, personId))).then((r) => r[0]);
	const { people: reviewers } = await reviewersOf(task);
	if (!isAdmin && member?.role !== 'coordinator' && !reviewers.some((p) => p.id === personId))
		throw error(403, 'Only the reviewers on the next review stage, or a coordinator, can review this task.');

	const summary = opts.summary?.trim() || null;
	if (opts.outcome === 'changes_requested' && !summary) throw error(400, 'Say briefly what needs changing; the detail stays in the Drive file.');

	const now = new Date().toISOString();
	const updates = opts.outcome === 'approved'
		? { status: 'done' as const, completedAt: now }
		: { status: 'returned' as const, iteration: task.iteration + 1 };
	const cycle = { id: ulid(), taskId: task.id, iteration: task.iteration, reviewerId: personId, outcome: opts.outcome, comments: summary, createdAt: now };
	const updated = await db.transaction(async (tx) => {
		await tx.insert(reviewCycles).values(cycle);
		const [t] = await tx.update(tasks).set({ ...updates, version: task.version + 1, updatedAt: now }).where(eq(tasks.id, task.id)).returning();
		await tx.insert(activityLog).values({
			id: ulid(), seriesId, actorId: personId, entity: 'review', entityId: task.id, action: opts.outcome,
			beforeJson: JSON.stringify({ status: task.status, iteration: task.iteration, version: task.version }),
			afterJson: JSON.stringify({ ...updates, version: task.version + 1, summary }), createdAt: now,
		});
		return t;
	});
	return json({ task: updated, review: cycle });
}
