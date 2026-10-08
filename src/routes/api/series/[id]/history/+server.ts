import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { requireMember } from '#lib/server/api-auth.ts';
import { stackState } from '#lib/server/history.ts';

// GET /api/series/:id/history — the batches the signed-in person's Undo and Redo buttons
// would act on, with a line describing each.
export const GET: RequestHandler = async ({ params, locals }) => {
	const { personId } = await requireMember(locals, params.id);
	return json(await stackState(personId, params.id));
};
