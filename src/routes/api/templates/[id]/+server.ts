import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { parseBody, requireAdmin } from '#lib/server/api-auth.ts';
import { parseOr400, updateTemplateSchema } from '#lib/server/validation.ts';
import { deleteTemplate, updateTemplate } from '#lib/server/templates.ts';

// PATCH /api/templates/:id — rename or redescribe a template. Admin only.
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const { personId } = await requireAdmin(locals);
	const patch = parseOr400(updateTemplateSchema, await parseBody(request));
	return json(await updateTemplate(params.id, patch, personId));
};

// DELETE /api/templates/:id — series made from it keep their own copy of the pipeline.
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const { personId } = await requireAdmin(locals);
	await deleteTemplate(params.id, personId);
	return new Response(null, { status: 204 });
};
