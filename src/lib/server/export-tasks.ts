/**
 * CSV export of a series' tasks (spec: Phase 2, CSV export of tasks). One row per task of the
 * live books and stages, in matrix order, with the same filters as the matrix and the
 * variance from the latest baseline, as on the book page.
 */
import { error } from '@sveltejs/kit';
import { and, asc, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	baselines, baselineTasks, books, people, reviewCycles, series, stages, stageTracks, taskAssignees, tasks, tracks, windows
} from '#lib/server/db/schema.ts';
import { refreshHolidays } from '#lib/server/calendar-db.ts';
import { workingDaysBetween } from '#lib/schedule/calendar.ts';
import { statusLabel, STATUS_LABEL } from '#lib/status.ts';
import { fileSlug, toCsv, type CsvValue } from '#lib/csv.ts';

/** The matrix filters; person may be '__none' for unassigned work. */
export type ExportFilters = { group?: string; batch?: string; person?: string; status?: string };

const CATEGORY_LABEL: Record<string, string> = {
	creation: 'Creation', review: 'Review', layout: 'Layout', publish: 'Publishing', gate: 'Gate', production: 'Production'
};

export async function exportTasks(seriesId: string, filters: ExportFilters, today = new Date().toISOString().slice(0, 10)) {
	const liveTask = and(eq(books.seriesId, seriesId), isNull(books.archivedAt), isNull(stages.archivedAt));
	const latest = db.select({ id: baselines.id }).from(baselines).where(eq(baselines.seriesId, seriesId)).orderBy(desc(baselines.createdAt)).limit(1);

	const [serRows, trackRows, stageRows, linkRows, bookRows, taskRows, assigneeRows, windowRows, baselineRows, baseRows, reviewRows] = await db.batch([
		db.select().from(series).where(eq(series.id, seriesId)),
		db.select({ id: tracks.id, name: tracks.name }).from(tracks).where(eq(tracks.seriesId, seriesId)),
		db.select().from(stages).where(and(eq(stages.seriesId, seriesId), isNull(stages.archivedAt))).orderBy(asc(stages.sortOrder)),
		db.select({ stageId: stageTracks.stageId, trackId: stageTracks.trackId }).from(stageTracks)
			.innerJoin(stages, eq(stages.id, stageTracks.stageId)).where(and(eq(stages.seriesId, seriesId), isNull(stages.archivedAt))),
		db.select().from(books).where(and(eq(books.seriesId, seriesId), isNull(books.archivedAt))).orderBy(asc(books.sortOrder)),
		db.select({ t: tasks }).from(tasks).innerJoin(books, eq(books.id, tasks.bookId)).innerJoin(stages, eq(stages.id, tasks.stageId)).where(liveTask),
		db.select({ taskId: taskAssignees.taskId, personId: taskAssignees.personId, isLead: taskAssignees.isLead, name: people.displayName })
			.from(taskAssignees).innerJoin(people, eq(people.id, taskAssignees.personId))
			.innerJoin(tasks, eq(tasks.id, taskAssignees.taskId)).innerJoin(books, eq(books.id, tasks.bookId)).innerJoin(stages, eq(stages.id, tasks.stageId))
			.where(liveTask).orderBy(asc(people.displayName)),
		db.select({ id: windows.id, label: windows.label }).from(windows).where(eq(windows.seriesId, seriesId)),
		db.select({ name: baselines.name }).from(baselines).where(eq(baselines.seriesId, seriesId)).orderBy(desc(baselines.createdAt)).limit(1),
		db.select({ taskId: baselineTasks.taskId, endDate: baselineTasks.endDate }).from(baselineTasks).where(inArray(baselineTasks.baselineId, latest)),
		db.select({ taskId: reviewCycles.taskId, n: count() }).from(reviewCycles)
			.innerJoin(tasks, eq(tasks.id, reviewCycles.taskId)).innerJoin(books, eq(books.id, tasks.bookId)).where(eq(books.seriesId, seriesId))
			.groupBy(reviewCycles.taskId)
	]);
	const ser = serRows[0];
	if (!ser) throw error(404, 'Series not found');
	await refreshHolidays(); // variance counts working days

	const trackName = new Map(trackRows.map((t) => [t.id, t.name]));
	const stageById = new Map(stageRows.map((s) => [s.id, s]));
	const stageOrder = new Map(stageRows.map((s, i) => [s.id, i]));
	const onTrack = new Set(linkRows.map((l) => `${l.trackId}:${l.stageId}`));
	const bookById = new Map(bookRows.map((b) => [b.id, b]));
	const bookOrder = new Map(bookRows.map((b, i) => [b.id, i]));
	const windowLabel = new Map(windowRows.map((w) => [w.id, w.label]));
	const baseEnd = new Map(baseRows.map((b) => [b.taskId, b.endDate]));
	const reviews = new Map(reviewRows.map((r) => [r.taskId, r.n]));
	const assigneesOf = new Map<string, typeof assigneeRows>();
	for (const a of assigneeRows) assigneesOf.set(a.taskId, [...(assigneesOf.get(a.taskId) ?? []), a]);

	const status = filters.status && filters.status in STATUS_LABEL ? filters.status : '';
	const keep = (t: typeof tasks.$inferSelect) => {
		const book = bookById.get(t.bookId)!;
		const stage = stageById.get(t.stageId)!;
		if (!onTrack.has(`${book.trackId}:${t.stageId}`)) return false; // as the matrix: stages the book's track has
		if (filters.group && (book.groupLabel ?? 'Other') !== filters.group) return false;
		if (filters.batch && String(book.batch) !== filters.batch) return false;
		if (status && t.status !== status) return false;
		const who = assigneesOf.get(t.id) ?? [];
		// Unassigned as on the matrix: open work, print gates left out (a coordinator's action).
		if (filters.person === '__none') return !who.length && stage.category !== 'gate' && t.status !== 'done';
		if (filters.person && !who.some((a) => a.personId === filters.person)) return false;
		return true;
	};

	const rows: CsvValue[][] = taskRows
		.map((r) => r.t)
		.filter(keep)
		.sort((a, b) => bookOrder.get(a.bookId)! - bookOrder.get(b.bookId)! || stageOrder.get(a.stageId)! - stageOrder.get(b.stageId)!)
		.map((t) => {
			const book = bookById.get(t.bookId)!;
			const stage = stageById.get(t.stageId)!;
			const who = assigneesOf.get(t.id) ?? [];
			const lead = who.find((a) => a.isLead) ?? who[0];
			const scheduled = t.scheduleState === 'scheduled';
			const base = baseEnd.get(t.id);
			return [
				book.code, book.name, book.groupLabel, book.batch, trackName.get(book.trackId),
				stage.name, CATEGORY_LABEL[stage.category] ?? stage.category, t.title,
				t.status === 'blocked' && t.statusBeforeBlock ? `Blocked (was ${statusLabel(t.statusBeforeBlock)})` : statusLabel(t.status),
				t.blockedReason,
				scheduled ? t.startDate : null, scheduled ? t.endDate : null, t.durationDays, t.dueDate,
				t.windowId ? windowLabel.get(t.windowId) : null, scheduled ? 'Scheduled' : 'Unscheduled', !!t.overflowAllowed,
				lead?.name, who.filter((a) => a !== lead).map((a) => a.name).join('; '),
				t.iteration, reviews.get(t.id) ?? 0,
				base, base && scheduled ? workingDaysBetween(base, t.endDate) : null,
				scheduled && t.status !== 'done' && t.endDate < today,
				t.completedAt?.slice(0, 10), t.feedbackUrl, t.notes
			];
		});

	const baselineName = baselineRows[0]?.name;
	const header = [
		'Book', 'Book name', ser.bookGroupLabel, 'Batch', 'Track',
		'Stage', 'Category', 'Task',
		'Status', 'Blocked reason',
		'Start', 'End', 'Working days', 'Due', 'Window', 'Schedule', 'Overflow allowed',
		'Lead', 'Other assignees',
		'Iteration', 'Reviews recorded',
		baselineName ? `Baseline end (${baselineName})` : 'Baseline end', 'Variance (working days)',
		'Late', 'Completed', 'Feedback link', 'Notes'
	];

	return {
		filename: `${fileSlug(ser.name)}-tasks-${today}.csv`,
		csv: toCsv(header, rows),
		count: rows.length
	};
}
