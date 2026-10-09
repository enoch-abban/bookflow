import type { PageServerLoad, Actions } from './$types';
import { db } from '#lib/server/db/index.ts';
import {
	tasks,
	taskAssignees,
	books,
	stages,
	series as seriesTable,
	people,
	seriesMembers,
} from '#lib/server/db/schema.ts';
import { eq, and, ne, asc, isNull, inArray } from 'drizzle-orm';
import { fail, isHttpError } from '@sveltejs/kit';
import { changeStatus } from '#lib/server/task-status.ts';
import { recordReview, reviewersOf } from '#lib/server/reviews.ts';

export const load: PageServerLoad = async ({ locals }) => {
	// Find person record linked to current user
	const person = locals.user
		? await db
				.select()
				.from(people)
				.where(eq(people.userId, locals.user.id))
				.then((r) => r[0] ?? null)
		: null;

	if (!person) return { person: null, groups: [], reviews: [] };

	const today = new Date().toISOString().slice(0, 10);
	const soonCutoff = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);

	const rows = await db
		.select({
			taskId: tasks.id,
			status: tasks.status,
			startDate: tasks.startDate,
			endDate: tasks.endDate,
			dueDate: tasks.dueDate,
			iteration: tasks.iteration,
			bookId: tasks.bookId,
			stageId: tasks.stageId,
			bookCode: books.code,
			bookName: books.name,
			stageName: stages.name,
			stageCategory: stages.category,
			seriesName: seriesTable.name,
			seriesId: seriesTable.id,
		})
		.from(taskAssignees)
		.innerJoin(tasks, eq(tasks.id, taskAssignees.taskId))
		.innerJoin(books, eq(books.id, tasks.bookId))
		.innerJoin(stages, eq(stages.id, tasks.stageId))
		.innerJoin(seriesTable, eq(seriesTable.id, books.seriesId))
		.where(and(eq(taskAssignees.personId, person.id), ne(tasks.status, 'done'), isNull(books.archivedAt), isNull(stages.archivedAt)))
		.orderBy(asc(tasks.endDate))
		.then((list) => Promise.all(list.map(async (r) => {
			// Whether a review stage follows decides Submit for review vs Done; in review, who it waits on.
			const who = await reviewersOf({ id: r.taskId, bookId: r.bookId, stageId: r.stageId });
			return { ...r, reviewed: who.reviewerTasks.length > 0, waitingOn: who.people.map((p) => p.name) };
		})));

	// Waiting for my review: work in review that the next review stage assigns to me.
	const mySeries = person.systemRole !== 'member'
		? null
		: await db.select({ id: seriesMembers.seriesId }).from(seriesMembers).where(eq(seriesMembers.personId, person.id)).then((r) => r.map((x) => x.id));
	const inReview = mySeries && !mySeries.length ? [] : await db
		.select({
			taskId: tasks.id, bookId: tasks.bookId, stageId: tasks.stageId, iteration: tasks.iteration, feedbackUrl: tasks.feedbackUrl,
			endDate: tasks.endDate, bookCode: books.code, stageName: stages.name, seriesName: seriesTable.name, seriesId: seriesTable.id,
		})
		.from(tasks)
		.innerJoin(books, eq(books.id, tasks.bookId))
		.innerJoin(stages, eq(stages.id, tasks.stageId))
		.innerJoin(seriesTable, eq(seriesTable.id, books.seriesId))
		.where(and(eq(tasks.status, 'in_review'), isNull(books.archivedAt), ...(mySeries ? [inArray(books.seriesId, mySeries)] : [])));
	const reviews = [];
	for (const r of inReview) {
		const who = await reviewersOf({ id: r.taskId, bookId: r.bookId, stageId: r.stageId });
		if (who.people.some((p) => p.id === person.id)) reviews.push(r);
	}

	// Group by urgency
	const overdue: typeof rows = [];
	const soon: typeof rows = [];
	const upcoming: typeof rows = [];

	for (const row of rows) {
		const end = row.dueDate ?? row.endDate;
		if (end < today) overdue.push(row);
		else if (end <= soonCutoff) soon.push(row);
		else upcoming.push(row);
	}

	return {
		person,
		reviews,
		groups: [
			{ label: 'Due or late', rows: overdue, urgent: true },
			{ label: 'Due soon', rows: soon, urgent: false },
			{ label: 'Upcoming', rows: upcoming, urgent: false },
		].filter((g) => g.rows.length > 0),
	};
};

// The status buttons share the API's rules: only assignees or a coordinator, allowed
// transitions only, gate and ISBN guards, version bump and activity log.
function statusAction(to: 'in_progress' | 'in_review' | 'done') {
	return async ({ request, locals }: Parameters<Actions[string]>[0]) => {
		if (!locals.user) return fail(401);
		const taskId = (await request.formData()).get('taskId')?.toString();
		if (!taskId) return fail(400);
		try {
			await changeStatus(locals, taskId, to);
		} catch (err) {
			if (isHttpError(err)) return fail(err.status, { taskId, message: err.body.message });
			throw err;
		}
	};
}

// Reviewers approve or return work from the Waiting for my review group.
function reviewAction(outcome: 'approved' | 'changes_requested') {
	return async ({ request, locals }: Parameters<Actions[string]>[0]) => {
		if (!locals.user) return fail(401);
		const fd = await request.formData();
		const taskId = fd.get('taskId')?.toString();
		if (!taskId) return fail(400);
		try {
			const res = await recordReview({ locals, taskId, outcome, summary: fd.get('summary')?.toString() ?? null });
			if (!res.ok) return fail(res.status, { taskId, message: (await res.json()).message ?? 'Could not record the review.' });
		} catch (err) {
			if (isHttpError(err)) return fail(err.status, { taskId, message: err.body.message });
			throw err;
		}
	};
}

export const actions: Actions = {
	approve: reviewAction('approved'),
	return: reviewAction('changes_requested'),
	start: statusAction('in_progress'),
	submit: statusAction('in_review'),
	done: statusAction('done'),
	resume: statusAction('in_progress'),
};
