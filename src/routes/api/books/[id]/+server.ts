import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { ulid } from 'ulid';
import { and, eq, ne } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { activityLog, books } from '#lib/server/db/schema.ts';
import { parseBody, requireCoord } from '#lib/server/api-auth.ts';
import { parseOr400, updateBookSchema } from '#lib/server/validation.ts';

type BookRow = typeof books.$inferSelect;

// PATCH /api/books/:id — code, name, group and batch. The code stays unique in the series.
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const before = await db.select().from(books).where(eq(books.id, params.id)).then((r) => r[0]);
	if (!before) throw error(404, 'Book not found');
	const { personId } = await requireCoord(locals, before.seriesId);
	const body = parseOr400(updateBookSchema, await parseBody(request));

	if (body.code !== undefined && body.code !== before.code) {
		const clash = await db.select({ id: books.id }).from(books)
			.where(and(eq(books.seriesId, before.seriesId), eq(books.code, body.code), ne(books.id, before.id)));
		if (clash.length) throw error(409, `Another book in this series already uses the code ${body.code}.`);
	}

	const changed = Object.fromEntries(
		Object.entries(body).filter(([k, v]) => v !== undefined && v !== before[k as keyof BookRow])
	) as Partial<BookRow>;
	if (!Object.keys(changed).length) return json({ book: before });

	const book = await db.transaction(async (tx) => {
		const [row] = await tx.update(books).set({ ...changed, version: before.version + 1 }).where(eq(books.id, before.id)).returning();
		await tx.insert(activityLog).values({
			id: ulid(), seriesId: before.seriesId, actorId: personId, entity: 'book', entityId: before.id, action: 'update',
			beforeJson: JSON.stringify(Object.fromEntries(Object.keys(changed).map((k) => [k, before[k as keyof BookRow]]))),
			afterJson: JSON.stringify(changed), createdAt: new Date().toISOString(),
		});
		return row;
	});
	return json({ book });
};
