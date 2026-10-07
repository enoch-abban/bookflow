import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { parseBody, requireAdmin } from '#lib/server/api-auth.ts';
import { holidaySchema, parseOr400 } from '#lib/server/validation.ts';
import { changeHoliday } from '#lib/server/holidays.ts';

// POST /api/holidays — add a holiday (admin); every series is refitted around it.
export const POST: RequestHandler = async ({ request, locals }) => {
	const { personId } = await requireAdmin(locals);
	const { date, label, preview } = parseOr400(holidaySchema, await parseBody(request));
	const res = await changeHoliday({ op: { kind: 'add', date, label }, actorId: personId, preview: !!preview });
	return json(res, { status: res.preview ? 200 : 201 });
};
