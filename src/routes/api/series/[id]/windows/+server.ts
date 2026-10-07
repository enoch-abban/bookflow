import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { parseBody, requireCoord } from '#lib/server/api-auth.ts';
import { createWindowSchema, parseOr400 } from '#lib/server/validation.ts';
import { changeWindows } from '#lib/server/window-change.ts';

// POST /api/series/:id/windows — add a window; refits the schedule when windows are enforced.
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { personId } = await requireCoord(locals, params.id);
	const { preview, ...fields } = parseOr400(createWindowSchema, await parseBody(request));
	const res = await changeWindows({ seriesId: params.id, actorId: personId, op: { kind: 'create', fields }, preview: !!preview });
	return json(res, { status: res.preview ? 200 : 201 });
};
