import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import {
	series as seriesTable,
	stages,
	books,
	tasks,
	taskAssignees,
	people,
	seriesMembers,
	windows as windowsTable,
	dependencies,
	holidays,
} from '#lib/server/db/schema.ts';
import { and, eq, inArray, asc, isNull, or } from 'drizzle-orm';
import { requireMember } from '#lib/server/api-auth.ts';
import { useHolidays } from '#lib/server/calendar-db.ts';

export const load: PageServerLoad = async ({ params, locals }) => {
	const sid = params.series;
	await requireMember(locals, sid);

	// One round trip for the whole timeline: the series, live stages and books, windows,
	// members, tasks with their assignees and links, the people on lanes, and holidays.
	const liveTask = and(eq(books.seriesId, sid), isNull(books.archivedAt), isNull(stages.archivedAt));
	const [serRows, stagesData, booksData, windowsData, membersData, taskRows, assigneeRows, depRows, peopleData, holidayRows] = await db.batch([
		db.select().from(seriesTable).where(eq(seriesTable.id, sid)),
		db.select().from(stages).where(and(eq(stages.seriesId, sid), isNull(stages.archivedAt))).orderBy(asc(stages.sortOrder)),
		db.select().from(books).where(and(eq(books.seriesId, sid), isNull(books.archivedAt))).orderBy(asc(books.sortOrder)),
		db.select().from(windowsTable).where(eq(windowsTable.seriesId, sid)).orderBy(asc(windowsTable.sortOrder)),
		db.select().from(seriesMembers).where(eq(seriesMembers.seriesId, sid)),
		db.select({ t: tasks }).from(tasks).innerJoin(books, eq(books.id, tasks.bookId)).innerJoin(stages, eq(stages.id, tasks.stageId)).where(liveTask),
		db.select({ a: taskAssignees }).from(taskAssignees)
			.innerJoin(tasks, eq(tasks.id, taskAssignees.taskId)).innerJoin(books, eq(books.id, tasks.bookId)).innerJoin(stages, eq(stages.id, tasks.stageId)).where(liveTask),
		db.select({ d: dependencies }).from(dependencies)
			.innerJoin(tasks, eq(tasks.id, dependencies.successorId)).innerJoin(books, eq(books.id, tasks.bookId)).innerJoin(stages, eq(stages.id, tasks.stageId)).where(liveTask),
		// Lanes for every member, plus anyone assigned here who is not one.
		db.select().from(people).where(or(
			inArray(people.id, db.select({ id: seriesMembers.personId }).from(seriesMembers).where(eq(seriesMembers.seriesId, sid))),
			inArray(people.id, db.select({ id: taskAssignees.personId }).from(taskAssignees)
				.innerJoin(tasks, eq(tasks.id, taskAssignees.taskId)).innerJoin(books, eq(books.id, tasks.bookId)).where(eq(books.seriesId, sid))),
		)),
		db.select().from(holidays).orderBy(asc(holidays.date)),
	]);
	const ser = serRows[0];
	if (!ser) throw error(404, 'Series not found');
	useHolidays(holidayRows);

	return {
		series: ser,
		stages: stagesData,
		books: booksData,
		tasks: taskRows.map((r) => r.t),
		assignees: assigneeRows.map((r) => r.a),
		deps: depRows.map((r) => r.d),
		windows: windowsData,
		people: peopleData,
		members: membersData,
		today: new Date().toISOString().slice(0, 10),
		holidays: holidayRows,
	};
};
