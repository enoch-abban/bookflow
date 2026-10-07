/**
 * The print and binding tracker (spec: Print and binding tracker). Each book has one
 * print record: copies planned and deposit copies (coordinators set these per book),
 * and the Production Unit's progress: printed, binder dates, bound, legal deposit.
 */
import { error, json } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import { ulid } from 'ulid';
import { db } from '#lib/server/db/index.ts';
import { activityLog, books, printRecords, series, seriesMembers, stages, taskAssignees, tasks } from '#lib/server/db/schema.ts';
import { resolvePerson } from './api-auth.ts';

type RecordRow = typeof printRecords.$inferSelect;
export type RecordEdit = Partial<Pick<RecordRow,
	'copiesPlanned' | 'depositCopies' | 'copiesPrinted' | 'printedOn' | 'sentToBinderOn' | 'returnedFromBinderOn' |
	'copiesBound' | 'depositSubmittedOn' | 'binderName' | 'binderContact' | 'notes'>>;

const PRODUCTION_STAGES = ['printing', 'binding', 'legal_deposit'];

/** Coordinator (or admin), or an assignee of the book's printing, binding or deposit task. */
export async function recordAccess(locals: App.Locals, book: typeof books.$inferSelect) {
	const { personId, isAdmin } = await resolvePerson(locals);
	const member = await db.select({ role: seriesMembers.role }).from(seriesMembers)
		.where(and(eq(seriesMembers.seriesId, book.seriesId), eq(seriesMembers.personId, personId))).then((r) => r[0]);
	const coordinator = isAdmin || member?.role === 'coordinator';
	const production = coordinator || await db.select({ id: tasks.id }).from(tasks)
		.innerJoin(stages, eq(stages.id, tasks.stageId))
		.innerJoin(taskAssignees, eq(taskAssignees.taskId, tasks.id))
		.where(and(eq(tasks.bookId, book.id), inArray(stages.key, PRODUCTION_STAGES), eq(taskAssignees.personId, personId)))
		.then((r) => r.length > 0);
	return { personId, coordinator, production };
}

export async function updateRecord(opts: { locals: App.Locals; bookId: string; edit: RecordEdit; version: number }) {
	const book = await db.select().from(books).where(eq(books.id, opts.bookId)).then((r) => r[0]);
	if (!book) throw error(404, 'Book not found');
	const access = await recordAccess(opts.locals, book);
	if (!access.production) throw error(403, 'Only a coordinator or the people on this book\'s printing, binding or deposit can update its print record.');
	if (!access.coordinator && (opts.edit.copiesPlanned !== undefined || opts.edit.depositCopies !== undefined))
		throw error(403, 'Only a coordinator can change the copies planned for a book.');

	const before = await db.select().from(printRecords).where(eq(printRecords.bookId, book.id)).then((r) => r[0]);
	if (!before) throw error(404, `${book.code} has no print record.`);
	if (opts.version !== before.version) return json({ error: 'version_conflict', record: before }, { status: 409 });

	const after = { ...before, ...opts.edit };
	if (after.copiesBound > after.copiesPrinted)
		throw error(422, `Copies bound (${after.copiesBound}) cannot exceed copies printed (${after.copiesPrinted}).`);
	if (after.sentToBinderOn && after.returnedFromBinderOn && after.returnedFromBinderOn < after.sentToBinderOn)
		throw error(422, 'The books cannot come back from the binder before they were sent.');

	const changed = Object.fromEntries(
		Object.entries(opts.edit).filter(([k, v]) => v !== undefined && v !== before[k as keyof RecordRow])
	) as Partial<RecordRow>;
	if (!Object.keys(changed).length) return json({ record: before });

	const now = new Date().toISOString();
	const record = await db.transaction(async (tx) => {
		const [row] = await tx.update(printRecords).set({ ...changed, version: before.version + 1, updatedAt: now })
			.where(eq(printRecords.bookId, book.id)).returning();
		await tx.insert(activityLog).values({
			id: ulid(), seriesId: book.seriesId, actorId: access.personId, entity: 'print_record', entityId: book.id, action: 'update',
			beforeJson: JSON.stringify(Object.fromEntries(Object.keys(changed).map((k) => [k, before[k as keyof RecordRow]]))),
			afterJson: JSON.stringify(changed), createdAt: now,
		});
		return row;
	});
	return json({ record });
}

/**
 * "Apply to all books": copy the series defaults into the print record of every book
 * whose printing has not started (no copies printed, printing task not started), and
 * list the books skipped. Saved as one batch.
 */
export async function applyDefaults(opts: {
	seriesId: string; actorId: string; fields: ('copiesPlanned' | 'depositCopies')[]; preview: boolean;
}) {
	const ser = await db.select().from(series).where(eq(series.id, opts.seriesId)).then((r) => r[0]);
	if (!ser) throw error(404, 'Series not found');
	const target = { copiesPlanned: ser.defaultCopies, depositCopies: ser.legalDepositCopies };

	const rows = await db.select({ book: books, record: printRecords }).from(books)
		.innerJoin(printRecords, eq(printRecords.bookId, books.id))
		.where(eq(books.seriesId, ser.id));
	const printing = await db.select({ bookId: tasks.bookId, status: tasks.status }).from(tasks)
		.innerJoin(stages, eq(stages.id, tasks.stageId)).innerJoin(books, eq(books.id, tasks.bookId))
		.where(and(eq(books.seriesId, ser.id), eq(stages.key, 'printing')));

	const updated: { code: string; from: Partial<RecordRow>; to: Partial<RecordRow> }[] = [];
	const skipped: { code: string; reason: string }[] = [];
	const unchanged: string[] = [];
	for (const { book, record } of rows.filter((r) => !r.book.archivedAt).sort((a, b) => a.book.sortOrder - b.book.sortOrder)) {
		const started = record.copiesPrinted > 0 || printing.some((p) => p.bookId === book.id && p.status !== 'not_started');
		if (started) { skipped.push({ code: book.code, reason: 'printing has started' }); continue; }
		const to = Object.fromEntries(opts.fields.filter((f) => record[f] !== target[f]).map((f) => [f, target[f]]));
		if (!Object.keys(to).length) { unchanged.push(book.code); continue; }
		updated.push({ code: book.code, from: Object.fromEntries(Object.keys(to).map((f) => [f, record[f as keyof RecordRow]])), to });
	}
	const report = { defaults: target, updated, skipped, unchanged };
	if (opts.preview) return { preview: true as const, ...report };

	const batchId = ulid();
	const now = new Date().toISOString();
	await db.transaction(async (tx) => {
		for (const u of updated) {
			const { book, record } = rows.find((r) => r.book.code === u.code)!;
			await tx.update(printRecords).set({ ...u.to, version: record.version + 1, updatedAt: now }).where(eq(printRecords.bookId, book.id));
			await tx.insert(activityLog).values({
				id: ulid(), seriesId: ser.id, actorId: opts.actorId, entity: 'print_record', entityId: book.id, action: 'apply_defaults',
				beforeJson: JSON.stringify({ ...u.from, version: record.version }), afterJson: JSON.stringify({ ...u.to, version: record.version + 1 }),
				batchId, createdAt: now,
			});
		}
	});
	return { preview: false as const, ...report, batchId };
}
