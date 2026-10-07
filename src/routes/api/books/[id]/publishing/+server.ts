import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { books } from '#lib/server/db/schema.ts';
import { parseBody, requireCoord } from '#lib/server/api-auth.ts';
import { parseOr400, publishingSchema } from '#lib/server/validation.ts';
import { setPublishing } from '#lib/server/publishing.ts';

// PATCH /api/books/:id/publishing — ISBN and edition. 422 for an invalid or duplicate
// ISBN-13; 409 confirm_required when an approved book's ISBN changes without confirmChange.
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const book = await db.select().from(books).where(eq(books.id, params.id)).then((r) => r[0]);
	if (!book) throw error(404, 'Book not found');
	const { personId } = await requireCoord(locals, book.seriesId);
	const body = parseOr400(publishingSchema, await parseBody(request));
	return setPublishing({ book, actorId: personId, ...body });
};
