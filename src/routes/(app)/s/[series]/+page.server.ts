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
	printRecords,
	reviewCycles,
	seriesMembers,
} from '#lib/server/db/schema.ts';
import { refreshHolidays } from '#lib/server/calendar-db.ts';
import { addWorkingDays } from '#lib/schedule/calendar.ts';
import { and, eq, inArray, asc, isNull } from 'drizzle-orm';

export const load: PageServerLoad = async ({ params }) => {
	const sid = params.series;

	const [ser] = await db.select().from(seriesTable).where(eq(seriesTable.id, sid));
	if (!ser) throw error(404, 'Series not found');

	const stagesData = await db
		.select()
		.from(stages)
		.where(and(eq(stages.seriesId, sid), isNull(stages.archivedAt)))
		.orderBy(asc(stages.sortOrder));

	const stageIds = stagesData.map((s) => s.id);
	const stageTrackLinks = stageIds.length
		? await db.select().from(stageTracks).where(inArray(stageTracks.stageId, stageIds))
		: [];

	const booksData = await db
		.select()
		.from(books)
		.where(and(eq(books.seriesId, sid), isNull(books.archivedAt)))
		.orderBy(asc(books.sortOrder));

	const bookIds = booksData.map((b) => b.id);
	const tasksData = bookIds.length
		? await db.select().from(tasks).where(and(inArray(tasks.bookId, bookIds), inArray(tasks.stageId, stageIds)))
		: [];

	const taskIds = tasksData.map((t) => t.id);
	const assigneesData = taskIds.length
		? await db.select().from(taskAssignees).where(inArray(taskAssignees.taskId, taskIds))
		: [];

	// Everyone who could appear in the Person filter: members plus anyone assigned here.
	const memberRows = await db.select({ personId: seriesMembers.personId }).from(seriesMembers).where(eq(seriesMembers.seriesId, sid));
	const personIds = [...new Set([...assigneesData.map((a) => a.personId), ...memberRows.map((m) => m.personId)])];
	const peopleData = personIds.length
		? await db.select().from(people).where(inArray(people.id, personIds))
		: [];

	// Copies against plan for the printing and binding cells (spec: Status matrix).
	const records = bookIds.length ? await db.select().from(printRecords).where(inArray(printRecords.bookId, bookIds)) : [];
	const copies = Object.fromEntries(records.map((r) => [r.bookId, { printed: r.copiesPrinted, bound: r.copiesBound, run: r.copiesPlanned + r.depositCopies }]));

	// Review badges: reviews recorded per task (pending = the task is In review).
	const reviewRows = taskIds.length ? await db.select({ taskId: reviewCycles.taskId }).from(reviewCycles).where(inArray(reviewCycles.taskId, taskIds)) : [];
	const reviewsDone: Record<string, number> = {};
	for (const r of reviewRows) reviewsDone[r.taskId] = (reviewsDone[r.taskId] ?? 0) + 1;

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

	// Unassigned work due to start within the next five working days (spec: Status matrix).
	// Gates are left out: approving for print is a coordinator's action, not an assignment.
	await refreshHolidays();
	const soon = addWorkingDays(today, 5);
	const assigned = new Set(assigneesData.map((a) => a.taskId));
	const gateIds = new Set(stagesData.filter((s) => s.category === 'gate').map((s) => s.id));
	const unassignedSoon = tasksData.filter((t) => !assigned.has(t.id) && !gateIds.has(t.stageId) && t.status !== 'done' && t.scheduleState === 'scheduled' && t.startDate <= soon).length;

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
		copies,
		reviewsDone,
		stats: { late, atRisk, projectedFinish, today, unassignedSoon },
	};
};
