import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { parseBody, requireCoord } from '#lib/server/api-auth.ts';
import { parseOr400, updateStageSchema } from '#lib/server/validation.ts';
import { editStage, loadStage } from '#lib/server/pipeline-edit.ts';
import { removeStage } from '#lib/server/removal.ts';

// PATCH /api/stages/:id — edit a stage. Changing ignoresWindows refits the schedule and
// changing the deadline rule recomputes due dates; with `preview` nothing is saved.
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const stage = await loadStage(params.id);
	const { personId } = await requireCoord(locals, stage.seriesId);
	const { preview, ...edit } = parseOr400(updateStageSchema, await parseBody(request));
	return json(await editStage({ stage, edit, actorId: personId, preview: !!preview }));
};

// DELETE /api/stages/:id — remove a stage from every book: not-started tasks go, started
// ones block (409), and the stage is archived instead when any of its tasks are Done.
export const DELETE: RequestHandler = async ({ params, request, url, locals }) => {
	const stage = await loadStage(params.id);
	const { personId } = await requireCoord(locals, stage.seriesId);
	const body = (await request.json().catch(() => ({}))) as { preview?: boolean };
	const preview = body.preview === true || url.searchParams.get('preview') === 'true';
	return json(await removeStage({ stageId: params.id, actorId: personId, preview }));
};
