import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { ulid } from 'ulid';
import { db } from '#lib/server/db/index.ts';
import { dependencies, tasks, books, activityLog } from '#lib/server/db/schema.ts';
import { eq, inArray } from 'drizzle-orm';
import { requireCoord } from '#lib/server/api-auth.ts';

// DELETE /api/dependencies/:id
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const { id } = params;

	const dep = await db.select().from(dependencies).where(eq(dependencies.id, id)).then(r => r[0]);
	if (!dep) throw error(404, 'Dependency not found');

	// Resolve series from the successor task
	const taskRow = await db.select({ bookId: tasks.bookId }).from(tasks).where(eq(tasks.id, dep.successorId)).then(r => r[0]);
	if (!taskRow) throw error(404, 'Task not found');

	const book = await db.select({ seriesId: books.seriesId }).from(books).where(eq(books.id, taskRow.bookId)).then(r => r[0]);
	if (!book) throw error(404, 'Book not found');

	const { personId } = await requireCoord(locals, book.seriesId);

	const now = new Date().toISOString();
	await db.transaction(async tx => {
		await tx.delete(dependencies).where(eq(dependencies.id, id));
		await tx.insert(activityLog).values({
			id:         ulid(),
			seriesId:   book.seriesId,
			actorId:    personId,
			entity:     'dependency',
			entityId:   id,
			action:     'delete',
			beforeJson: JSON.stringify(dep),
			createdAt:  now,
		});
	});

	return json({ deleted: id });
};
