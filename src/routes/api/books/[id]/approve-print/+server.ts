import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { books } from '#lib/server/db/schema.ts';
import { parseBody, requireCoord } from '#lib/server/api-auth.ts';
import { approvePrintSchema, parseOr400 } from '#lib/server/validation.ts';
import { approvePrint } from '#lib/server/publishing.ts';

// POST /api/books/:id/approve-print — record print approval; 409 lists what blocks it.
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const book = await db.select().from(books).where(eq(books.id, params.id)).then((r) => r[0]);
	if (!book) throw error(404, 'Book not found');
	const { personId } = await requireCoord(locals, book.seriesId);
	const { note } = parseOr400(approvePrintSchema, await parseBody(request));
	return approvePrint({ book, actorId: personId, note });
};
