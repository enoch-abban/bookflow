import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { parseBody, requireCoord } from '#lib/server/api-auth.ts';
import { createTrackSchema, parseOr400 } from '#lib/server/validation.ts';
import { createTrack } from '#lib/server/pipeline-grow.ts';

// POST /api/series/:id/tracks — a new track made of existing stages.
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { personId } = await requireCoord(locals, params.id);
	const { name, stageIds } = parseOr400(createTrackSchema, await parseBody(request));
	return json(await createTrack({ seriesId: params.id, actorId: personId, name, stageIds }), { status: 201 });
};
