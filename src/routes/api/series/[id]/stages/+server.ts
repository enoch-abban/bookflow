import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { parseBody, requireCoord } from '#lib/server/api-auth.ts';
import { addStageSchema, parseOr400 } from '#lib/server/validation.ts';
import { addStage } from '#lib/server/pipeline-grow.ts';

// POST /api/series/:id/stages — add a stage to tracks, joining the dependency pattern
// after one stage and before another ("insert" or "alongside").
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { personId } = await requireCoord(locals, params.id);
	const { preview, ...input } = parseOr400(addStageSchema, await parseBody(request));
	const res = await addStage({ seriesId: params.id, actorId: personId, input, preview: !!preview, today: new Date().toISOString().slice(0, 10) });
	return json(res, { status: res.preview ? 200 : 201 });
};
