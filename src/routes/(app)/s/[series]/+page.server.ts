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
import { and, asc, count, eq, inArray, isNull, or } from 'drizzle-orm';
import { requireMember } from '#lib/server/api-auth.ts';

export const load: PageServerLoad = async ({ params, locals }) => {
	const sid = params.series;
	await requireMember(locals, sid);

	// One round trip for the whole matrix: the series, its live stages and books, their tasks,
	// assignees, the people who could appear in the Person filter, print records and reviews.
	const liveTask = and(eq(books.seriesId, sid), isNull(books.archivedAt), isNull(stages.archivedAt));
	const [serRows, stagesData, stageTrackLinks, booksData, taskRows, assigneesData, peopleRows, records, reviewRows] = await db.batch([
		db.select().from(seriesTable).where(eq(seriesTable.id, sid)),
		db.select().from(stages).where(and(eq(stages.seriesId, sid), isNull(stages.archivedAt))).orderBy(asc(stages.sortOrder)),
		db.select({ stageId: stageTracks.stageId, trackId: stageTracks.trackId }).from(stageTracks)
			.innerJoin(stages, eq(stages.id, stageTracks.stageId)).where(and(eq(stages.seriesId, sid), isNull(stages.archivedAt))),
		db.select().from(books).where(and(eq(books.seriesId, sid), isNull(books.archivedAt))).orderBy(asc(books.sortOrder)),
		db.select({ t: tasks }).from(tasks).innerJoin(books, eq(books.id, tasks.bookId)).innerJoin(stages, eq(stages.id, tasks.stageId)).where(liveTask),
		db.select({ taskId: taskAssignees.taskId, personId: taskAssignees.personId, isLead: taskAssignees.isLead }).from(taskAssignees)
			.innerJoin(tasks, eq(tasks.id, taskAssignees.taskId)).innerJoin(books, eq(books.id, tasks.bookId)).innerJoin(stages, eq(stages.id, tasks.stageId)).where(liveTask),
		// Members, plus anyone assigned here who is not one.
		db.select({ id: people.id, displayName: people.displayName }).from(people).where(or(
			inArray(people.id, db.select({ id: seriesMembers.personId }).from(seriesMembers).where(eq(seriesMembers.seriesId, sid))),
			inArray(people.id, db.select({ id: taskAssignees.personId }).from(taskAssignees)
				.innerJoin(tasks, eq(tasks.id, taskAssignees.taskId)).innerJoin(books, eq(books.id, tasks.bookId)).where(eq(books.seriesId, sid))),
		)),
		db.select({ r: printRecords }).from(printRecords).innerJoin(books, eq(books.id, printRecords.bookId)).where(and(eq(books.seriesId, sid), isNull(books.archivedAt))),
		db.select({ taskId: reviewCycles.taskId, n: count() }).from(reviewCycles)
			.innerJoin(tasks, eq(tasks.id, reviewCycles.taskId)).innerJoin(books, eq(books.id, tasks.bookId)).where(eq(books.seriesId, sid))
			.groupBy(reviewCycles.taskId),
	]);
	const ser = serRows[0];
	if (!ser) throw error(404, 'Series not found');
	const tasksData = taskRows.map((r) => r.t);
	const peopleData = peopleRows;

	// Copies against plan for the printing and binding cells (spec: Status matrix).
	const copies = Object.fromEntries(records.map(({ r }) => [r.bookId, { printed: r.copiesPrinted, bound: r.copiesBound, run: r.copiesPlanned + r.depositCopies }]));

	// Review badges: reviews recorded per task (pending = the task is In review).
	const reviewsDone: Record<string, number> = Object.fromEntries(reviewRows.map((r) => [r.taskId, r.n]));

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
