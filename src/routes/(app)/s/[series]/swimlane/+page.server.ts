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
import { eq, inArray, asc } from 'drizzle-orm';

export const load: PageServerLoad = async ({ params }) => {
	const sid = params.series;

	const [ser] = await db.select().from(seriesTable).where(eq(seriesTable.id, sid));
	if (!ser) throw error(404, 'Series not found');

	const [stagesData, booksData, windowsData, membersData] = await Promise.all([
		db.select().from(stages).where(eq(stages.seriesId, sid)).orderBy(asc(stages.sortOrder)),
		db.select().from(books).where(eq(books.seriesId, sid)).orderBy(asc(books.sortOrder)),
		db.select().from(windowsTable).where(eq(windowsTable.seriesId, sid)).orderBy(asc(windowsTable.sortOrder)),
		db.select().from(seriesMembers).where(eq(seriesMembers.seriesId, sid)),
	]);

	const bookIds = booksData.map((b) => b.id);
	const tasksData = bookIds.length
		? await db.select().from(tasks).where(inArray(tasks.bookId, bookIds))
		: [];

	const taskIds = tasksData.map((t) => t.id);
	const [assigneesData, depsData] = taskIds.length
		? await Promise.all([
				db.select().from(taskAssignees).where(inArray(taskAssignees.taskId, taskIds)),
				db.select().from(dependencies).where(inArray(dependencies.successorId, taskIds)),
			])
		: [[], []];

	const personIds = [...new Set(membersData.map((m) => m.personId))];
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
	};
};
