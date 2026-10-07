import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { parseBody, requireCoord } from '#lib/server/api-auth.ts';
import { parseOr400, updateStageSchema } from '#lib/server/validation.ts';
import { editStage, loadStage } from '#lib/server/pipeline-edit.ts';

// PATCH /api/stages/:id — edit a stage. Changing ignoresWindows refits the schedule and
// changing the deadline rule recomputes due dates; with `preview` nothing is saved.
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const stage = await loadStage(params.id);
	const { personId } = await requireCoord(locals, stage.seriesId);
	const { preview, ...edit } = parseOr400(updateStageSchema, await parseBody(request));
	return json(await editStage({ stage, edit, actorId: personId, preview: !!preview }));
};
