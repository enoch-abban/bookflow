/**
 * Loads all tasks and dependencies for a series in one shot.
 * Used by scheduling endpoints to build the propagation context.
 */
import { db } from '#lib/server/db/index.ts';
import { books, tasks, dependencies } from '#lib/server/db/schema.ts';
import { eq, inArray } from 'drizzle-orm';
import type { SchedTask, SchedDep } from './scheduler.ts';

export async function loadSeriesContext(seriesId: string) {
	const booksData = await db.select({ id: books.id }).from(books).where(eq(books.seriesId, seriesId));
	const bookIds = booksData.map(b => b.id);

	const tasksData = bookIds.length
		? await db.select().from(tasks).where(inArray(tasks.bookId, bookIds))
		: [];

	const taskIds = tasksData.map(t => t.id);
	const depsData = taskIds.length
		? await db.select().from(dependencies).where(inArray(dependencies.successorId, taskIds))
		: [];

	const taskMap = new Map<string, SchedTask>(
		tasksData.map(t => [t.id, {
			id: t.id, startDate: t.startDate, endDate: t.endDate,
			durationDays: t.durationDays, status: t.status, windowId: t.windowId,
			version: t.version,
		}])
	);

	const depList: SchedDep[] = depsData.map(d => ({
		predecessorId: d.predecessorId,
		successorId: d.successorId,
		lagDays: d.lagDays,
	}));

	return { taskMap, depList, tasksData, booksData };
}
