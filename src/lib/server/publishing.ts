/**
 * ISBN entry and print approval (spec: Recording ISBNs, Print approval gate).
 */
import { error, json } from '@sveltejs/kit';
import { and, eq, ne } from 'drizzle-orm';
import { ulid } from 'ulid';
import { db } from '#lib/server/db/index.ts';
import { activityLog, books, dependencies, printApprovals, printRecords, stages, tasks } from '#lib/server/db/schema.ts';
import { isValidIsbn13, normalizeIsbn } from '../isbn.ts';

type BookRow = typeof books.$inferSelect;

async function bookTasks(bookId: string) {
	return db.select({ t: tasks, stage: stages }).from(tasks).innerJoin(stages, eq(stages.id, tasks.stageId)).where(eq(tasks.bookId, bookId));
}

/** Printing has started once its task has moved off Not started or copies are recorded as printed. */
async function printingStarted(bookId: string, own: Awaited<ReturnType<typeof bookTasks>>) {
	const printing = own.find((r) => r.stage.key === 'printing')?.t;
	const record = await db.select({ printed: printRecords.copiesPrinted }).from(printRecords).where(eq(printRecords.bookId, bookId)).then((r) => r[0]);
	return (!!printing && printing.status !== 'not_started') || (record?.printed ?? 0) > 0;
}

/**
 * Set a book's ISBN and edition. The ISBN must be a valid ISBN-13 no other book uses.
 * Changing it after print approval needs `confirmChange` (else 409 confirm_required);
 * if printing has not started, the approval is then withdrawn and the gate task reset.
 */
export async function setPublishing(opts: {
	book: BookRow; actorId: string; isbn?: string | null; edition?: string | null; version: number; confirmChange?: boolean;
}) {
	const { book } = opts;
	if (book.archivedAt) throw error(409, `${book.code} is archived.`);
	if (opts.version !== book.version) return json({ error: 'version_conflict', book }, { status: 409 });

	const isbn = opts.isbn === undefined ? book.isbn : opts.isbn ? normalizeIsbn(opts.isbn) : null;
	const edition = opts.edition === undefined ? book.edition : opts.edition?.trim() || null;
	if (isbn && !isValidIsbn13(isbn)) return json({ error: 'invalid_isbn', message: 'That is not a valid ISBN-13: check the 13 digits and the check digit.' }, { status: 422 });
	if (isbn && isbn !== book.isbn) {
		const clash = await db.select({ code: books.code }).from(books).where(and(eq(books.isbn, isbn), ne(books.id, book.id))).then((r) => r[0]);
		if (clash) return json({ error: 'duplicate_isbn', message: `That ISBN is already recorded for ${clash.code}.` }, { status: 422 });
	}

	const own = await bookTasks(book.id);
	const isbnChanged = isbn !== book.isbn;
	if (isbnChanged && !isbn && own.some((r) => r.stage.key === 'isbn_issued' && r.t.status === 'done'))
		return json({ error: 'isbn_required', message: 'ISBN issued is Done, so the ISBN cannot be removed.' }, { status: 422 });

	const approval = await db.select().from(printApprovals).where(eq(printApprovals.bookId, book.id)).then((r) => r[0] ?? null);
	if (isbnChanged && approval && !opts.confirmChange)
		return json({
			error: 'confirm_required',
			message: `${book.code} is already approved for print. Changing the ISBN withdraws that approval unless printing has started.`,
		}, { status: 409 });

	const withdraw = isbnChanged && !!approval && !(await printingStarted(book.id, own));
	const gate = own.find((r) => r.stage.category === 'gate')?.t;
	const now = new Date().toISOString();
	const log = (entity: 'book' | 'approval' | 'task', entityId: string, action: string, before: unknown, after: unknown) => ({
		id: ulid(), seriesId: book.seriesId, actorId: opts.actorId, entity, entityId, action,
		beforeJson: before ? JSON.stringify(before) : null, afterJson: after ? JSON.stringify(after) : null, createdAt: now,
	});

	const updated = await db.transaction(async (tx) => {
		const [row] = await tx.update(books).set({ isbn, edition, version: book.version + 1 }).where(eq(books.id, book.id)).returning();
		await tx.insert(activityLog).values(log('book', book.id, 'publishing', { isbn: book.isbn, edition: book.edition }, { isbn, edition }));
		if (withdraw) {
			await tx.delete(printApprovals).where(eq(printApprovals.bookId, book.id));
			await tx.insert(activityLog).values(log('approval', book.id, 'withdraw', approval, { reason: 'ISBN changed' }));
			if (gate && gate.status === 'done') {
				const reset = { status: 'not_started' as const, completedAt: null, version: gate.version + 1, updatedAt: now };
				await tx.update(tasks).set(reset).where(eq(tasks.id, gate.id));
				await tx.insert(activityLog).values(log('task', gate.id, 'status', { status: gate.status, version: gate.version }, reset));
			}
		}
		return row;
	});
	return json({ book: updated, approvalWithdrawn: withdraw });
}

/**
 * Approve a book for print: who, when and an optional note. Refused (409) while the
 * ISBN is missing or any earlier task is not Done. "Earlier" means every predecessor
 * of the book's print approval task; a book without that task uses its tasks in
 * stages before printing. The gate task is set to Done in the same transaction.
 */
export async function approvePrint(opts: { book: BookRow; actorId: string; note?: string | null }) {
	const { book } = opts;
	if (book.archivedAt) throw error(409, `${book.code} is archived.`);
	const existing = await db.select().from(printApprovals).where(eq(printApprovals.bookId, book.id));
	if (existing.length) throw error(409, `${book.code} is already approved for print.`);

	const own = await bookTasks(book.id);
	const gate = own.find((r) => r.stage.category === 'gate')?.t ?? null;
	let earlier: typeof own;
	if (gate) {
		// Every task the gate waits for, directly or through others.
		const seriesTasks = await db.select({ t: tasks, stage: stages }).from(tasks)
			.innerJoin(stages, eq(stages.id, tasks.stageId)).innerJoin(books, eq(books.id, tasks.bookId))
			.where(eq(books.seriesId, book.seriesId));
		const deps = await db.select({ d: dependencies }).from(dependencies)
			.innerJoin(tasks, eq(tasks.id, dependencies.successorId)).innerJoin(books, eq(books.id, tasks.bookId))
			.where(eq(books.seriesId, book.seriesId)).then((r) => r.map((x) => x.d));
		const byId = new Map(own.map((r) => [r.t.id, r]));
		const all = new Map(seriesTasks.map((r) => [r.t.id, r]));
		const seen = new Set<string>();
		const queue = [gate.id];
		while (queue.length) {
			const cur = queue.shift()!;
			for (const d of deps) if (d.successorId === cur && !seen.has(d.predecessorId)) { seen.add(d.predecessorId); queue.push(d.predecessorId); }
		}
		earlier = [...seen].map((id) => byId.get(id) ?? all.get(id)!).filter(Boolean);
	} else {
		const printing = own.find((r) => r.stage.key === 'printing')?.stage
			?? own.filter((r) => r.stage.category === 'production').sort((a, b) => a.stage.sortOrder - b.stage.sortOrder)[0]?.stage;
		earlier = printing ? own.filter((r) => r.stage.sortOrder < printing.sortOrder) : own.filter((r) => r.stage.category !== 'production');
	}

	const unfinished = earlier.filter((r) => r.t.status !== 'done').map((r) => ({ stage: r.stage.name, status: r.t.status }));
	if (!book.isbn || unfinished.length) {
		const parts = [!book.isbn ? 'the ISBN is not recorded' : '', unfinished.length ? `${unfinished.length} earlier ${unfinished.length === 1 ? 'task is' : 'tasks are'} not Done` : '']
			.filter(Boolean).join(' and ');
		return json({ error: 'blocked', message: `${book.code} cannot be approved yet: ${parts}.`, missingIsbn: !book.isbn, unfinished }, { status: 409 });
	}

	const now = new Date().toISOString();
	const approval = { bookId: book.id, approvedBy: opts.actorId, approvedAt: now, note: opts.note?.trim() || null };
	await db.transaction(async (tx) => {
		await tx.insert(printApprovals).values(approval);
		await tx.insert(activityLog).values({
			id: ulid(), seriesId: book.seriesId, actorId: opts.actorId, entity: 'approval', entityId: book.id, action: 'create',
			afterJson: JSON.stringify(approval), createdAt: now,
		});
		if (gate && gate.status !== 'done') {
			const done = { status: 'done' as const, completedAt: now, version: gate.version + 1, updatedAt: now };
			await tx.update(tasks).set(done).where(eq(tasks.id, gate.id));
			await tx.insert(activityLog).values({
				id: ulid(), seriesId: book.seriesId, actorId: opts.actorId, entity: 'task', entityId: gate.id, action: 'status',
				beforeJson: JSON.stringify({ status: gate.status, version: gate.version }), afterJson: JSON.stringify(done), createdAt: now,
			});
		}
	});
	return json({ approval, gateTaskId: gate?.id ?? null }, { status: 201 });
}
