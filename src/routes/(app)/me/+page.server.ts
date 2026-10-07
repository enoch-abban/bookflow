import type { PageServerLoad, Actions } from './$types';
import { db } from '#lib/server/db/index.ts';
import {
	tasks,
	taskAssignees,
	books,
	stages,
	series as seriesTable,
	people,
} from '#lib/server/db/schema.ts';
import { eq, and, ne, asc, isNull } from 'drizzle-orm';
import { fail, isHttpError } from '@sveltejs/kit';
import { changeStatus } from '#lib/server/task-status.ts';

export const load: PageServerLoad = async ({ locals }) => {
	// Find person record linked to current user
	const person = locals.user
		? await db
				.select()
				.from(people)
				.where(eq(people.userId, locals.user.id))
				.then((r) => r[0] ?? null)
		: null;

	if (!person) return { person: null, groups: [] };

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
		.orderBy(asc(tasks.endDate));

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

export const actions: Actions = {
	start: statusAction('in_progress'),
	submit: statusAction('in_review'),
	done: statusAction('done'),
	resume: statusAction('in_progress'),
};
