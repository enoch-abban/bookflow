import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { parseBody, requireCoord } from '#lib/server/api-auth.ts';
import { parseOr400, updateWindowSchema } from '#lib/server/validation.ts';
import { changeWindows, loadWindow } from '#lib/server/window-change.ts';

// PATCH /api/windows/:id — change label or dates; refits the schedule when windows are enforced.
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const win = await loadWindow(params.id);
	const { personId } = await requireCoord(locals, win.seriesId);
	const { preview, ...fields } = parseOr400(updateWindowSchema, await parseBody(request));
	return json(await changeWindows({ seriesId: win.seriesId, actorId: personId, op: { kind: 'update', id: win.id, fields }, preview: !!preview }));
};

// DELETE /api/windows/:id — body or query `preview`. Started and done tasks keep their dates and lose the window.
export const DELETE: RequestHandler = async ({ params, request, url, locals }) => {
	const win = await loadWindow(params.id);
	const { personId } = await requireCoord(locals, win.seriesId);
	const body = (await request.json().catch(() => ({}))) as { preview?: boolean };
	const preview = body.preview === true || url.searchParams.get('preview') === 'true';
	return json(await changeWindows({ seriesId: win.seriesId, actorId: personId, op: { kind: 'delete', id: win.id }, preview }));
};
