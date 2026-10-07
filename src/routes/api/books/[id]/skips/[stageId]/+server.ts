import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { books } from '#lib/server/db/schema.ts';
import { requireCoord } from '#lib/server/api-auth.ts';
import { liftSkip, skipStage } from '#lib/server/skips.ts';

async function context(bookId: string, locals: App.Locals, request: Request, url: URL) {
	const book = await db.select({ seriesId: books.seriesId }).from(books).where(eq(books.id, bookId)).then((r) => r[0]);
	if (!book) throw error(404, 'Book not found');
	const { personId } = await requireCoord(locals, book.seriesId);
	const body = (await request.json().catch(() => ({}))) as { preview?: boolean };
	return { personId, preview: body.preview === true || url.searchParams.get('preview') === 'true' };
}

// PUT /api/books/:id/skips/:stageId — skip a stage for this book; its not-started task is
// removed and relinked around. Refused (409) if the task has started or is Done.
export const PUT: RequestHandler = async ({ params, locals, request, url }) => {
	const { personId, preview } = await context(params.id, locals, request, url);
	return json(await skipStage({ bookId: params.id, stageId: params.stageId, actorId: personId, preview }));
};

// DELETE /api/books/:id/skips/:stageId — lift the skip; the task is created again.
export const DELETE: RequestHandler = async ({ params, locals, request, url }) => {
	const { personId, preview } = await context(params.id, locals, request, url);
	return json(await liftSkip({
		bookId: params.id, stageId: params.stageId, actorId: personId, preview,
		today: new Date().toISOString().slice(0, 10),
	}));
};
