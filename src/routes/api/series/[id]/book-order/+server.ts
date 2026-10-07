import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { parseBody, requireCoord } from '#lib/server/api-auth.ts';
import { orderSchema, parseOr400 } from '#lib/server/validation.ts';
import { reorder } from '#lib/server/pipeline-edit.ts';

// PUT /api/series/:id/book-order — { ids } in display order. Dependencies are untouched.
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const { personId } = await requireCoord(locals, params.id);
	const { ids } = parseOr400(orderSchema, await parseBody(request));
	return json({ books: await reorder('book', params.id, ids, personId) });
};
