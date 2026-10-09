import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { series as seriesTable, stages, books, tasks, taskAssignees, people, seriesMembers } from '#lib/server/db/schema.ts';
import { and, eq, inArray, asc, isNull, or } from 'drizzle-orm';
import { refreshHolidays } from '#lib/server/calendar-db.ts';
import { requireMember } from '#lib/server/api-auth.ts';
import { isWorkingDay } from '#lib/schedule/calendar.ts';
import { summarize, workload } from '#lib/schedule/workload.ts';

const WEEKS = 8;

function addDays(date: string, n: number): string {
	const d = new Date(date + 'T12:00:00Z');
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
}
function monday(date: string): string {
	const dow = new Date(date + 'T12:00:00Z').getUTCDay();
	return addDays(date, -((dow + 6) % 7));
}

export const load: PageServerLoad = async ({ params, url, locals }) => {
	const sid = params.series;
	await requireMember(locals, sid);

	await refreshHolidays();
	// One round trip: the series, live stages and books, members, tasks, their assignees, and
	// everyone who gets a row (members plus anyone assigned here).
	const liveTask = and(eq(books.seriesId, sid), isNull(books.archivedAt), isNull(stages.archivedAt));
	const [serRows, stagesData, booksData, membersData, taskRows, assigneeRows, peopleData] = await db.batch([
		db.select().from(seriesTable).where(eq(seriesTable.id, sid)),
		db.select().from(stages).where(and(eq(stages.seriesId, sid), isNull(stages.archivedAt))),
		db.select().from(books).where(and(eq(books.seriesId, sid), isNull(books.archivedAt))).orderBy(asc(books.sortOrder)),
		db.select().from(seriesMembers).where(eq(seriesMembers.seriesId, sid)),
		db.select({ t: tasks }).from(tasks).innerJoin(books, eq(books.id, tasks.bookId)).innerJoin(stages, eq(stages.id, tasks.stageId)).where(liveTask),
		db.select({ a: taskAssignees }).from(taskAssignees)
			.innerJoin(tasks, eq(tasks.id, taskAssignees.taskId)).innerJoin(books, eq(books.id, tasks.bookId)).innerJoin(stages, eq(stages.id, tasks.stageId)).where(liveTask),
		db.select().from(people).where(or(
			inArray(people.id, db.select({ id: seriesMembers.personId }).from(seriesMembers).where(eq(seriesMembers.seriesId, sid))),
			inArray(people.id, db.select({ id: taskAssignees.personId }).from(taskAssignees)
				.innerJoin(tasks, eq(tasks.id, taskAssignees.taskId)).innerJoin(books, eq(books.id, tasks.bookId)).where(eq(books.seriesId, sid))),
		)),
	]);
	const ser = serRows[0];
	if (!ser) throw error(404, 'Series not found');
	const tasksData = taskRows.map((r) => r.t);
	const assigneesData = assigneeRows.map((r) => r.a);

	// Range: eight weeks from a Monday. Default is this week, or the plan's first week if it starts later.
	const today = new Date().toISOString().slice(0, 10);
	const placed = tasksData.filter((t) => t.scheduleState !== 'unscheduled');
	const planStart = placed.reduce<string | null>((m, t) => (!m || t.startDate < m ? t.startDate : m), null);
	const planEnd = placed.reduce<string | null>((m, t) => (!m || t.endDate > m ? t.endDate : m), null);
	const asked = url.searchParams.get('from');
	const from = monday(/^\d{4}-\d{2}-\d{2}$/.test(asked ?? '') ? asked! : planStart && planStart > today ? planStart : today);
	const to = addDays(from, WEEKS * 7 - 1);
	const days: string[] = [];
	for (let d = from; d <= to; d = addDays(d, 1)) if (isWorkingDay(d)) days.push(d);

	const includeDone = url.searchParams.get('done') === '1';
	const grid = workload(tasksData, assigneesData, days, { includeDone });

	// Rows: every member, plus anyone assigned work here who is not a member (capacity 1).
	const memberOf = new Map(membersData.map((m) => [m.personId, m]));
	const rows = peopleData
		.map((p) => {
			const m = memberOf.get(p.id);
			const capacity = m?.capacity ?? 1;
			const row = grid.get(p.id);
			return {
				personId: p.id,
				name: p.displayName,
				team: m ? (m.teamLabel || 'No team') : 'Not in this series',
				capacity,
				cells: Object.fromEntries(row ?? []),
				...summarize(row, capacity),
			};
		})
		.sort((a, b) => a.team.localeCompare(b.team) || a.name.localeCompare(b.name));

	// Details for the tasks behind the cells.
	const stageName = new Map(stagesData.map((s) => [s.id, s.name]));
	const bookCode = new Map(booksData.map((b) => [b.id, b.code]));
	const used = new Set(rows.flatMap((r) => Object.values(r.cells).flatMap((c) => c.taskIds)));
	const taskInfo = Object.fromEntries(
		tasksData.filter((t) => used.has(t.id)).map((t) => [t.id, {
			book: bookCode.get(t.bookId) ?? '', stage: stageName.get(t.stageId) ?? '',
			startDate: t.startDate, endDate: t.endDate, status: t.status,
		}])
	);
	const assigned = new Set(assigneesData.map((a) => a.taskId));
	const unscheduled = tasksData.filter((t) => t.scheduleState === 'unscheduled' && t.durationDays > 0 && assigned.has(t.id)).length;

	return {
		series: ser, days, rows, taskInfo, unscheduled, includeDone, today,
		from, prev: addDays(from, -WEEKS * 7), next: addDays(from, WEEKS * 7),
		planStart, planEnd,
	};
};
