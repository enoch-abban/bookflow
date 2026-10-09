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
} from '#lib/server/db/schema.ts';
import { and, eq, inArray, asc, isNull } from 'drizzle-orm';
import { refreshHolidays } from '#lib/server/calendar-db.ts';

export const load: PageServerLoad = async ({ params }) => {
	const sid = params.series;

	const [ser] = await db.select().from(seriesTable).where(eq(seriesTable.id, sid));
	if (!ser) throw error(404, 'Series not found');

	const [stagesData, booksData, windowsData, membersData] = await Promise.all([
		db.select().from(stages).where(and(eq(stages.seriesId, sid), isNull(stages.archivedAt))).orderBy(asc(stages.sortOrder)),
		db.select().from(books).where(and(eq(books.seriesId, sid), isNull(books.archivedAt))).orderBy(asc(books.sortOrder)),
		db.select().from(windowsTable).where(eq(windowsTable.seriesId, sid)).orderBy(asc(windowsTable.sortOrder)),
		db.select().from(seriesMembers).where(eq(seriesMembers.seriesId, sid)),
	]);

	const bookIds = booksData.map((b) => b.id);
	const tasksData = bookIds.length
		? await db.select().from(tasks).where(and(inArray(tasks.bookId, bookIds), inArray(tasks.stageId, stagesData.map((s) => s.id))))
		: [];

	const taskIds = tasksData.map((t) => t.id);
	const [assigneesData, depsData] = taskIds.length
		? await Promise.all([
				db.select().from(taskAssignees).where(inArray(taskAssignees.taskId, taskIds)),
				db.select().from(dependencies).where(inArray(dependencies.successorId, taskIds)),
			])
		: [[], []];

	// Lanes for every member, plus anyone assigned here who is not one.
	const personIds = [...new Set([...membersData.map((m) => m.personId), ...assigneesData.map((a) => a.personId)])];
	const peopleData = personIds.length
		? await db.select().from(people).where(inArray(people.id, personIds))
		: [];

	return {
		series: ser,
		stages: stagesData,
		books: booksData,
		tasks: tasksData,
		assignees: assigneesData,
		deps: depsData,
		windows: windowsData,
		people: peopleData,
		members: membersData,
		today: new Date().toISOString().slice(0, 10),
		holidays: await refreshHolidays(),
	};
};
