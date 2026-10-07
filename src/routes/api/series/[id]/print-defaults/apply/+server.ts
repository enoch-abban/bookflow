import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { parseBody, requireCoord } from '#lib/server/api-auth.ts';
import { applyDefaultsSchema, parseOr400 } from '#lib/server/validation.ts';
import { applyDefaults } from '#lib/server/print-records.ts';

// POST /api/series/:id/print-defaults/apply — series defaults into every print record whose
// printing has not started; lists the books skipped. One batch.
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { personId } = await requireCoord(locals, params.id);
	const { fields, preview } = parseOr400(applyDefaultsSchema, await parseBody(request));
	return json(await applyDefaults({ seriesId: params.id, actorId: personId, fields, preview: !!preview }));
};
