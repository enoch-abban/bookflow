// Loads the admin's holidays into the shared working-day calendar. Called before any
// scheduling, so a holiday added in one request is honoured by the next.
import { asc } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { holidays } from '#lib/server/db/schema.ts';
import { setHolidays } from '../schedule/calendar.ts';

export async function refreshHolidays() {
	const rows = await db.select().from(holidays).orderBy(asc(holidays.date));
	setHolidays(rows.map((r) => r.date));
	return rows;
}
