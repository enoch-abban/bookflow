import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { requireSystemAdmin } from '#lib/server/api-auth.ts';
import { changeHoliday } from '#lib/server/holidays.ts';

// DELETE /api/holidays/:date — remove a holiday (admin); every series is refitted.
export const DELETE: RequestHandler = async ({ params, request, url, locals }) => {
	const { personId } = await requireSystemAdmin(locals);
	const body = (await request.json().catch(() => ({}))) as { preview?: boolean };
	const preview = body.preview === true || url.searchParams.get('preview') === 'true';
	return json(await changeHoliday({ op: { kind: 'remove', date: params.date }, actorId: personId, preview }));
};
