// Loads the admin's holidays into the shared working-day calendar. Called before any scheduling.
// Reads reuse a copy for up to 30 seconds, saving a database round trip on most requests;
// anything that writes dates passes { fresh: true }, and a holiday change clears the copy at once.
import { asc } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { holidays } from '#lib/server/db/schema.ts';
import { setHolidays } from '../schedule/calendar.ts';

const MAX_AGE_MS = 30_000;
let cached: { rows: (typeof holidays.$inferSelect)[]; at: number } | null = null;

export async function refreshHolidays(opts: { fresh?: boolean } = {}) {
	if (!opts.fresh && cached && Date.now() - cached.at < MAX_AGE_MS) {
		setHolidays(cached.rows.map((r) => r.date));
		return cached.rows;
	}
	const rows = await db.select().from(holidays).orderBy(asc(holidays.date));
	cached = { rows, at: Date.now() };
	setHolidays(rows.map((r) => r.date));
	return rows;
}

/** Use holiday rows read as part of a larger batch: apply them and keep them as the fresh copy. */
export function useHolidays(rows: (typeof holidays.$inferSelect)[]) {
	cached = { rows, at: Date.now() };
	setHolidays(rows.map((r) => r.date));
}

/** Forget the copy, after holidays change (on this instance; others refresh within 30 seconds). */
export function forgetHolidays() {
	cached = null;
}
