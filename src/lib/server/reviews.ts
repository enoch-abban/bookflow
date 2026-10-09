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
import { db, writeAll } from '#lib/server/db/index.ts';
import { activityLog, books, dependencies, people, reviewCycles, seriesMembers, stages, taskAssignees, tasks } from '#lib/server/db/schema.ts';
import { resolvePerson } from './api-auth.ts';

type TaskRow = typeof tasks.$inferSelect;

type TaskRef = Pick<TaskRow, 'id' | 'bookId' | 'stageId'>;

/**
 * The review-stage tasks that review each task: the nearest ones downstream in the same book
 * that are not Done. Empty for review-stage tasks and for work with no review after it.
 * Any number of tasks costs two queries (their books' tasks, then those tasks' links).
 */
export async function reviewerTasksMany(list: TaskRef[]): Promise<Map<string, TaskRow[]>> {
	const out = new Map<string, TaskRow[]>(list.map((t) => [t.id, []]));
	const bookIds = [...new Set(list.map((t) => t.bookId))];
	if (!bookIds.length) return out;
	const own = await db.select({ t: tasks, isReview: stages.isReview }).from(tasks)
		.innerJoin(stages, eq(stages.id, tasks.stageId)).where(inArray(tasks.bookId, bookIds));
	const byId = new Map(own.map((r) => [r.t.id, r]));
	const ids = own.map((r) => r.t.id);
	const deps = ids.length ? await db.select().from(dependencies).where(inArray(dependencies.predecessorId, ids)) : [];

	for (const task of list) out.set(task.id, findReviewerTasks(task.id, byId, deps));
	return out;
}

/**
 * The search itself, over rows already loaded: breadth-first from the task through its book's
 * links; the first layer that holds unfinished review tasks wins.
 */
export function findReviewerTasks<T extends { id: string; status: string }>(
	taskId: string,
	byId: Map<string, { t: T; isReview: number }>,
	deps: { predecessorId: string; successorId: string }[],
): T[] {
	if (byId.get(taskId)?.isReview) return [];
	let layer = [taskId];
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

export async function reviewerTasks(task: TaskRef): Promise<TaskRow[]> {
	return (await reviewerTasksMany([task])).get(task.id) ?? [];
}

/** People who may approve or return each task: its reviewer tasks' assignees. Three queries in all. */
export async function reviewersOfMany(list: TaskRef[]) {
	const rtBy = await reviewerTasksMany(list);
	const rtIds = [...new Set([...rtBy.values()].flat().map((t) => t.id))];
	const rows = rtIds.length
		? await db.select({ taskId: taskAssignees.taskId, id: people.id, name: people.displayName }).from(taskAssignees)
			.innerJoin(people, eq(people.id, taskAssignees.personId)).where(inArray(taskAssignees.taskId, rtIds))
		: [];
	const out = new Map<string, { reviewerTasks: TaskRow[]; people: { id: string; name: string }[] }>();
	for (const t of list) {
		const rt = rtBy.get(t.id) ?? [];
		const ps = rows.filter((r) => rt.some((x) => x.id === r.taskId)).map(({ id, name }) => ({ id, name }));
		out.set(t.id, { reviewerTasks: rt, people: [...new Map(ps.map((p) => [p.id, p])).values()] });
	}
	return out;
}

/** People who may approve or return `task`: its reviewer tasks' assignees. */
export async function reviewersOf(task: TaskRef) {
	return (await reviewersOfMany([task])).get(task.id)!;
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
	// One round trip: the review, the task and the log entry, all or nothing.
	const [, rows] = await writeAll([
		db.insert(reviewCycles).values(cycle),
		db.update(tasks).set({ ...updates, version: task.version + 1, updatedAt: now }).where(eq(tasks.id, task.id)).returning(),
		db.insert(activityLog).values({
			id: ulid(), seriesId, actorId: personId, entity: 'review', entityId: task.id, action: opts.outcome,
			beforeJson: JSON.stringify({ status: task.status, iteration: task.iteration, version: task.version }),
			afterJson: JSON.stringify({ ...updates, version: task.version + 1, summary }), createdAt: now,
		}),
	]);
	const updated = (rows as TaskRow[])[0];
	return json({ task: updated, review: cycle });
}
