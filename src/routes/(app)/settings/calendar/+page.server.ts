import type { PageServerLoad } from './$types';
import { requireAdmin } from '#lib/server/api-auth.ts';
import { refreshHolidays } from '#lib/server/calendar-db.ts';

export const load: PageServerLoad = async ({ locals }) => {
	await requireAdmin(locals);
	return { holidays: await refreshHolidays() };
};
