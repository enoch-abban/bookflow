import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { parseBody, requireCoord } from '#lib/server/api-auth.ts';
import { baselineSchema, parseOr400 } from '#lib/server/validation.ts';
import { saveBaseline } from '#lib/server/baselines.ts';

// POST /api/series/:id/baselines — freeze the current planned dates under a name.
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { personId } = await requireCoord(locals, params.id);
	const { name } = parseOr400(baselineSchema, await parseBody(request));
	return json(await saveBaseline({ seriesId: params.id, actorId: personId, name }), { status: 201 });
};
