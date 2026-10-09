/**
 * Loads all tasks, dependencies and window rules for a series in one shot.
 * Used by scheduling endpoints to build the propagation context.
 */
import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { books, tasks, dependencies, holidays, series, stages, windows } from '#lib/server/db/schema.ts';
import { asc, eq } from 'drizzle-orm';
import type { SchedTask, SchedDep, WindowRules } from './scheduler.ts';
import type { Win } from '../schedule/windows.ts';
import { useHolidays } from './calendar-db.ts';

export type SeriesContext = Awaited<ReturnType<typeof loadSeriesContext>>;

export async function loadSeriesContext(seriesId: string) {
	// One round trip: the current holidays (dates are about to be written), the series, its
	// books, windows, tasks and links.
	const [holidayRows, serRows, booksData, windowRows, rows, depsData] = await db.batch([
		db.select().from(holidays).orderBy(asc(holidays.date)),
		db.select().from(series).where(eq(series.id, seriesId)),
		db.select({ id: books.id, code: books.code, archivedAt: books.archivedAt }).from(books).where(eq(books.seriesId, seriesId)),
		db.select().from(windows).where(eq(windows.seriesId, seriesId)).orderBy(asc(windows.startDate)),
		db.select({ task: tasks, ignoresWindows: stages.ignoresWindows, stageKey: stages.key, stageArchived: stages.archivedAt })
			.from(tasks).innerJoin(stages, eq(stages.id, tasks.stageId)).innerJoin(books, eq(books.id, tasks.bookId))
			.where(eq(books.seriesId, seriesId)),
		db.select({ id: dependencies.id, predecessorId: dependencies.predecessorId, successorId: dependencies.successorId, lagDays: dependencies.lagDays })
			.from(dependencies).innerJoin(tasks, eq(tasks.id, dependencies.successorId)).innerJoin(books, eq(books.id, tasks.bookId))
			.where(eq(books.seriesId, seriesId)),
	]);
	useHolidays(holidayRows);
	const ser = serRows[0];
	if (!ser) throw error(404, 'Series not found');
	const tasksData = rows.map(r => r.task);

	const taskMap = new Map<string, SchedTask>(
		rows.map(({ task: t, ignoresWindows }) => [t.id, {
			id: t.id, startDate: t.startDate, endDate: t.endDate,
			durationDays: t.durationDays, status: t.status, statusBeforeBlock: t.statusBeforeBlock,
			windowId: t.windowId, scheduleState: t.scheduleState,
			overflowAllowed: !!t.overflowAllowed, ignoresWindows: !!ignoresWindows,
			version: t.version,
		}])
	);

	const depList: SchedDep[] = depsData.map(d => ({
		predecessorId: d.predecessorId,
		successorId: d.successorId,
		lagDays: d.lagDays,
	}));

	const wins: (Win & { label: string })[] = windowRows.map(w => ({ id: w.id, startDate: w.startDate, endDate: w.endDate, label: w.label }));
	const rules: WindowRules = { enforce: !!ser.enforceWindows, windows: wins, overflowDays: ser.windowOverflowDays };

	// A book's projected finish is its binding task's end (spec: Projected dates).
	const bookCode = new Map(booksData.map(b => [b.id, b.code]));
	const archivedBooks = new Set(booksData.filter(b => b.archivedAt).map(b => b.id));
	const finishTaskIds = new Set(rows.filter(r => r.stageKey === 'binding' && !r.stageArchived && !archivedBooks.has(r.task.bookId)).map(r => r.task.id));
	const labels = new Map(tasksData.map(t => [t.id, `${t.title} · ${bookCode.get(t.bookId) ?? ''}`]));

	return { series: ser, taskMap, depList, tasksData, booksData, rules, windows: wins, finishTaskIds, labels };
}

/** Latest end among the finish tasks (binding), or among all tasks when a series has none. */
export function projectedFinish(taskMap: Map<string, SchedTask>, finishTaskIds: Set<string>): string | null {
	let max: string | null = null;
	for (const t of taskMap.values()) {
		if (finishTaskIds.size && !finishTaskIds.has(t.id)) continue;
		if (!max || t.endDate > max) max = t.endDate;
	}
	return max;
}
