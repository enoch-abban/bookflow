import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { parseBody, requireCoord } from '#lib/server/api-auth.ts';
import { parseOr400, saveTemplateSchema } from '#lib/server/validation.ts';
import { saveTemplate } from '#lib/server/templates.ts';

// POST /api/series/:id/template — save this series' pipeline as a template.
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { personId } = await requireCoord(locals, params.id);
	const { name, description } = parseOr400(saveTemplateSchema, await parseBody(request));
	return json(await saveTemplate({ seriesId: params.id, name, description: description ?? null, actorId: personId }), { status: 201 });
};
