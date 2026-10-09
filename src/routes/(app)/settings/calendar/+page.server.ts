import type { PageServerLoad } from './$types';
import { requireSystemAdmin } from '#lib/server/api-auth.ts';
import { refreshHolidays } from '#lib/server/calendar-db.ts';

export const load: PageServerLoad = async ({ locals }) => {
	await requireSystemAdmin(locals);
	return { holidays: await refreshHolidays() };
};
