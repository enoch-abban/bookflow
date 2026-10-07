import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { books } from '#lib/server/db/schema.ts';
import { parseBody, requireCoord } from '#lib/server/api-auth.ts';
import { changeTrackSchema, parseOr400 } from '#lib/server/validation.ts';
import { changeTrack } from '#lib/server/pipeline-grow.ts';

// PUT /api/books/:id/track — move a book to another track; 409 names started tasks in the way.
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const book = await db.select({ seriesId: books.seriesId }).from(books).where(eq(books.id, params.id)).then((r) => r[0]);
	if (!book) throw error(404, 'Book not found');
	const { personId } = await requireCoord(locals, book.seriesId);
	const { trackId, preview } = parseOr400(changeTrackSchema, await parseBody(request));
	return json(await changeTrack({ bookId: params.id, trackId, actorId: personId, preview: !!preview, today: new Date().toISOString().slice(0, 10) }));
};
