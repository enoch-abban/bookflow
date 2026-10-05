import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import {
	series as seriesTable,
	stages,
	stageTracks,
	books,
	tasks,
	taskAssignees,
	people,
} from '#lib/server/db/schema.ts';
import { eq, inArray, asc } from 'drizzle-orm';

export const load: PageServerLoad = async ({ params }) => {
	const sid = params.series;

	const [ser] = await db.select().from(seriesTable).where(eq(seriesTable.id, sid));
	if (!ser) throw error(404, 'Series not found');

	const stagesData = await db
		.select()
		.from(stages)
		.where(eq(stages.seriesId, sid))
		.orderBy(asc(stages.sortOrder));

	const stageIds = stagesData.map((s) => s.id);
	const stageTrackLinks = stageIds.length
		? await db.select().from(stageTracks).where(inArray(stageTracks.stageId, stageIds))
		: [];

	const booksData = await db
		.select()
		.from(books)
		.where(eq(books.seriesId, sid))
		.orderBy(asc(books.sortOrder));

	const bookIds = booksData.map((b) => b.id);
	const tasksData = bookIds.length
		? await db.select().from(tasks).where(inArray(tasks.bookId, bookIds))
		: [];

	const taskIds = tasksData.map((t) => t.id);
	const assigneesData = taskIds.length
		? await db.select().from(taskAssignees).where(inArray(taskAssignees.taskId, taskIds))
		: [];

	const personIds = [...new Set(assigneesData.map((a) => a.personId))];
	const peopleData = personIds.length
		? await db.select().from(people).where(inArray(people.id, personIds))
		: [];

	// Build stats
	const today = new Date().toISOString().slice(0, 10);
	let late = 0;
	let atRisk = 0;
	for (const t of tasksData) {
		if (t.status === 'done' || t.status === 'blocked') continue;
		if (t.endDate < today) late++;
		else {
			const msLeft = new Date(t.endDate).getTime() - new Date(today).getTime();
			if (msLeft < 3 * 24 * 60 * 60 * 1000) atRisk++;
		}
	}

	// Latest binding end date = projected finish
	const projectedFinish = tasksData
		.filter((t) => {
			const stage = stagesData.find((s) => s.id === t.stageId);
			return stage?.key === 'binding';
		})
		.reduce<string | null>((max, t) => (!max || t.endDate > max ? t.endDate : max), null);

	return {
		series: ser,
		stages: stagesData,
		stageTrackLinks,
		books: booksData,
		tasks: tasksData,
		assignees: assigneesData,
		people: peopleData,
		stats: { late, atRisk, projectedFinish, today },
	};
};
