import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { parseBody, requireCoord } from '#lib/server/api-auth.ts';
import { addBookSchema, parseOr400 } from '#lib/server/validation.ts';
import { addBook } from '#lib/server/pipeline-structure.ts';

// POST /api/series/:id/books — add a book, scheduled "like another book" or "from a date".
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { personId } = await requireCoord(locals, params.id);
	const { preview, ...input } = parseOr400(addBookSchema, await parseBody(request));
	const res = await addBook({
		seriesId: params.id, actorId: personId, input, preview: !!preview,
		today: new Date().toISOString().slice(0, 10),
	});
	return json(res, { status: res.preview ? 200 : 201 });
};
