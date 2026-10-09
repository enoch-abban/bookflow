/**
 * Reversing an undo or a redo (spec: Undo and redo). Their log entries are snapshots: for each
 * row touched, `before` is its state before the step and `after` its state after. Reversing
 * the step puts every row back to `before`:
 *
 *   before and after  fields are set back (tasks, settings, windows, print records)
 *   before only       the row was removed, so it is inserted again (with its bundle)
 *   after only        the row was brought back or created, so it is deleted again
 *
 * The new step logs the same kind of snapshots, so redo and undo can alternate indefinitely.
 * Like undo, it first checks that nothing it touches has changed since, and refuses if so.
 */
import { and, eq, inArray, or } from 'drizzle-orm';
import { currentAssignment, setAssignment } from '#lib/server/assignees.ts';
import { ulid } from 'ulid';
import { db } from '#lib/server/db/index.ts';
import {
	activityLog, baselineTasks, books, bookStageSkips, dependencies, holidays, printRecords, series, stageLinks,
	stageTracks, stages, taskAssignees, taskComments, tasks, tracks, windows,
} from '#lib/server/db/schema.ts';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Json = Record<string, unknown>;
type Row = typeof activityLog.$inferSelect;
type Op = { entry: Row; entity: string; id: string; before: Json | null; after: Json | null };

const SETTINGS = { series, stage: stages, book: books } as const;
const SKIP_FIELDS = new Set(['version', 'updatedAt']);
const same = (a: unknown, b: unknown) => a === b || (a == null && b == null);

/** Everything that hangs off a task, captured before it is deleted. */
export async function taskBundle(tx: Tx | typeof db, id: string) {
	const task = await tx.select().from(tasks).where(eq(tasks.id, id)).then((r) => r[0]);
	if (!task) return null;
	const [assignees, deps, baseline, comments] = await Promise.all([
		tx.select().from(taskAssignees).where(eq(taskAssignees.taskId, id)),
		tx.select().from(dependencies).where(or(eq(dependencies.predecessorId, id), eq(dependencies.successorId, id))),
		tx.select().from(baselineTasks).where(eq(baselineTasks.taskId, id)),
		tx.select().from(taskComments).where(eq(taskComments.taskId, id)),
	]);
	return { task, assignees, dependencies: deps, baseline, comments };
}
type TaskBundle = NonNullable<Awaited<ReturnType<typeof taskBundle>>>;

async function insertTask(tx: Tx, b: TaskBundle | Json) {
	const bundle = ('task' in b ? b : { task: b }) as Partial<TaskBundle> & { task: typeof tasks.$inferInsert };
	await tx.insert(tasks).values(bundle.task).onConflictDoNothing();
	if (bundle.assignees?.length) await tx.insert(taskAssignees).values(bundle.assignees).onConflictDoNothing();
	if (bundle.baseline?.length) await tx.insert(baselineTasks).values(bundle.baseline).onConflictDoNothing();
	if (bundle.comments?.length) await tx.insert(taskComments).values(bundle.comments).onConflictDoNothing();
	return bundle.dependencies ?? [];
}

async function deleteTask(tx: Tx, id: string) {
	await tx.delete(dependencies).where(or(eq(dependencies.predecessorId, id), eq(dependencies.successorId, id)));
	await tx.delete(taskAssignees).where(eq(taskAssignees.taskId, id));
	await tx.delete(tasks).where(eq(tasks.id, id));
}

/** Why this step cannot be reversed (the rows changed since), or an empty list. */
async function conflicts(ops: Op[]): Promise<{ taskIds: string[]; other: string[] }> {
	const taskIds: string[] = [];
	const other: string[] = [];
	for (const op of ops) {
		const { entity, id, before, after } = op;
		if (before && after) {
			if (entity === 'task') {
				const cur = await db.select({ version: tasks.version }).from(tasks).where(eq(tasks.id, id)).then((r) => r[0]);
				if (!cur || (typeof after.version === 'number' && cur.version !== after.version)) taskIds.push(id);
			} else if (entity in SETTINGS) {
				const table = SETTINGS[entity as keyof typeof SETTINGS];
				const cur = await db.select().from(table).where(eq(table.id, id)).then((r) => r[0] as Json | undefined);
				if (!cur || Object.entries(after).some(([k, v]) => !SKIP_FIELDS.has(k) && k in cur && !same(cur[k], v))) other.push(`${entity} settings`);
			} else if (entity === 'window') {
				const cur = await db.select().from(windows).where(eq(windows.id, id)).then((r) => r[0]);
				if (!cur || cur.label !== after.label || cur.startDate !== after.startDate || cur.endDate !== after.endDate) other.push(`window ${after.label}`);
			} else if (entity === 'print_record') {
				const cur = await db.select({ version: printRecords.version }).from(printRecords).where(eq(printRecords.bookId, id)).then((r) => r[0]);
				if (!cur || (typeof after.version === 'number' && cur.version !== after.version)) other.push('a print record');
			}
		} else if (before && !after) {
			// Must not have come back some other way.
			if (entity === 'task') {
				const t = ((before.task ?? before) as Json).id as string;
				if (await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, t)).then((r) => r.length)) taskIds.push(t);
			}
			if (entity === 'book') {
				const b = (before.book ?? before) as Json;
				if (await db.select({ id: books.id }).from(books).where(eq(books.id, b.id as string)).then((r) => r.length)) other.push(`book ${b.code}`);
			}
		} else if (after && entity === 'task') {
			// A task to delete again must be as the step left it.
			const cur = await db.select({ version: tasks.version }).from(tasks).where(eq(tasks.id, id)).then((r) => r[0]);
			if (cur && typeof after.version === 'number' && cur.version !== after.version) taskIds.push(id);
		}
	}
	return { taskIds: [...new Set(taskIds)], other: [...new Set(other)] };
}

const ORDER_INSERT = ['window', 'track', 'stage', 'book', 'task', 'dependency', 'skip', 'stage_link', 'holiday'];
const ORDER_DELETE = ['dependency', 'stage_link', 'skip', 'task', 'book', 'stage', 'track', 'window', 'holiday'];

/**
 * Reverse an undo or redo batch as `action` ('redo' reverses an undo; 'undo' reverses a redo).
 * Returns the new batch id, or the conflicts that stopped it.
 */
export async function reverseStep(opts: { sourceBatchId: string; entries: Row[]; actorId: string; action: 'undo' | 'redo' }) {
	const ops: Op[] = opts.entries.map((e) => ({
		entry: e, entity: e.entity, id: e.entityId,
		before: e.beforeJson ? JSON.parse(e.beforeJson) : null, after: e.afterJson ? JSON.parse(e.afterJson) : null,
	}));
	const found = await conflicts(ops);
	if (found.taskIds.length || found.other.length) return { ok: false as const, ...found };

	const batchId = ulid();
	const now = new Date().toISOString();
	const seriesId = opts.entries.find((e) => e.seriesId)?.seriesId ?? null;
	const changed: string[] = [];

	await db.transaction(async (tx) => {
		const log = (op: Op, before: unknown, after: unknown) =>
			tx.insert(activityLog).values({
				id: ulid(), seriesId: op.entity === 'holiday' ? null : op.entry.seriesId, actorId: opts.actorId,
				entity: op.entry.entity, entityId: op.id, action: opts.action,
				beforeJson: before == null ? null : JSON.stringify(before), afterJson: after == null ? null : JSON.stringify(after),
				batchId, revertsBatchId: opts.sourceBatchId, createdAt: now,
			});

		// 1. Rows removed by the step come back, parents first.
		const inserts = ops.filter((o) => o.before && !o.after).sort((a, b) => ORDER_INSERT.indexOf(a.entity) - ORDER_INSERT.indexOf(b.entity));
		const pendingDeps: Json[] = [];
		for (const op of inserts) {
			const b = op.before!;
			switch (op.entity) {
				case 'window': await tx.insert(windows).values(b as typeof windows.$inferInsert).onConflictDoNothing(); break;
				case 'track': {
					const bundle = ('track' in b ? b : { track: b }) as { track: typeof tracks.$inferInsert; stageTracks?: (typeof stageTracks.$inferInsert)[] };
					await tx.insert(tracks).values(bundle.track).onConflictDoNothing();
					if (bundle.stageTracks?.length) await tx.insert(stageTracks).values(bundle.stageTracks).onConflictDoNothing();
					break;
				}
				case 'stage': {
					const bundle = ('stage' in b ? b : { stage: b }) as { stage: typeof stages.$inferInsert; stageTracks?: (typeof stageTracks.$inferInsert)[]; skips?: (typeof bookStageSkips.$inferInsert)[] };
					await tx.insert(stages).values(bundle.stage).onConflictDoNothing();
					if (bundle.stageTracks?.length) await tx.insert(stageTracks).values(bundle.stageTracks).onConflictDoNothing();
					if (bundle.skips?.length) await tx.insert(bookStageSkips).values(bundle.skips).onConflictDoNothing();
					break;
				}
				case 'book': {
					const bundle = ('book' in b ? b : { book: b }) as { book: typeof books.$inferInsert; skips?: (typeof bookStageSkips.$inferInsert)[]; printRecord?: typeof printRecords.$inferInsert | null; tasks?: TaskBundle[] };
					await tx.insert(books).values(bundle.book).onConflictDoNothing();
					if (bundle.skips?.length) await tx.insert(bookStageSkips).values(bundle.skips).onConflictDoNothing();
					if (bundle.printRecord) await tx.insert(printRecords).values(bundle.printRecord).onConflictDoNothing();
					for (const t of bundle.tasks ?? []) pendingDeps.push(...(await insertTask(tx, t)));
					break;
				}
				case 'task': pendingDeps.push(...(await insertTask(tx, b))); break;
				case 'dependency': pendingDeps.push(b); break;
				case 'skip': await tx.insert(bookStageSkips).values(b as typeof bookStageSkips.$inferInsert).onConflictDoNothing(); break;
				case 'stage_link': await tx.insert(stageLinks).values(b as typeof stageLinks.$inferInsert).onConflictDoNothing(); break;
				case 'holiday': await tx.insert(holidays).values(b as typeof holidays.$inferInsert).onConflictDoNothing(); break;
				default: continue;
			}
			if (op.entity === 'task') changed.push(op.id);
			await log(op, null, b);
		}
		// Links go in once both ends exist again.
		for (const d of pendingDeps) await tx.insert(dependencies).values(d as typeof dependencies.$inferInsert).onConflictDoNothing();

		// 2. Fields set back.
		for (const op of ops.filter((o) => o.before && o.after)) {
			const target = Object.fromEntries(Object.entries(op.before!).filter(([k]) => !SKIP_FIELDS.has(k)));
			if (op.entity === 'task' && Array.isArray(target.personIds)) {
				// An assignment: put the assignees back rather than task fields.
				const cur = await tx.select().from(tasks).where(eq(tasks.id, op.id)).then((r) => r[0]);
				if (!cur) continue;
				const was = await currentAssignment(tx, op.id);
				const set = await setAssignment(tx, op.id, { personIds: target.personIds as string[], leadId: (target.leadId as string | null) ?? null });
				await tx.update(tasks).set({ version: cur.version + 1, updatedAt: now }).where(eq(tasks.id, op.id));
				await log(op, { ...was, version: cur.version }, { ...set, version: cur.version + 1 });
				changed.push(op.id);
			} else if (op.entity === 'task') {
				const cur = await tx.select().from(tasks).where(eq(tasks.id, op.id)).then((r) => r[0]);
				if (!cur) continue;
				const prior = Object.fromEntries(Object.keys(target).map((k) => [k, cur[k as keyof typeof cur]]));
				const set = { ...target, version: cur.version + 1, updatedAt: now };
				await tx.update(tasks).set(set).where(eq(tasks.id, op.id));
				await log(op, { ...prior, version: cur.version }, set);
				changed.push(op.id);
			} else if (op.entity in SETTINGS) {
				const table = SETTINGS[op.entity as keyof typeof SETTINGS];
				const cur = await tx.select().from(table).where(eq(table.id, op.id)).then((r) => r[0] as Json | undefined);
				if (!cur) continue;
				await tx.update(table).set(target).where(eq(table.id, op.id));
				await log(op, Object.fromEntries(Object.keys(target).map((k) => [k, cur[k]])), target);
			} else if (op.entity === 'window') {
				const cur = await tx.select().from(windows).where(eq(windows.id, op.id)).then((r) => r[0]);
				if (!cur) continue;
				await tx.update(windows).set({ label: target.label as string, startDate: target.startDate as string, endDate: target.endDate as string }).where(eq(windows.id, op.id));
				await log(op, cur, { ...cur, label: target.label, startDate: target.startDate, endDate: target.endDate });
			} else if (op.entity === 'print_record') {
				const cur = await tx.select().from(printRecords).where(eq(printRecords.bookId, op.id)).then((r) => r[0]);
				if (!cur) continue;
				const set = { ...target, version: cur.version + 1, updatedAt: now };
				await tx.update(printRecords).set(set).where(eq(printRecords.bookId, op.id));
				await log(op, { ...Object.fromEntries(Object.keys(target).map((k) => [k, cur[k as keyof typeof cur]])), version: cur.version }, set);
			}
		}

		// 3. Rows the step brought back or created are removed again, children first, each
		//    logged as a full bundle so the next step can restore it.
		const deletes = ops.filter((o) => !o.before && o.after).sort((a, b) => ORDER_DELETE.indexOf(a.entity) - ORDER_DELETE.indexOf(b.entity));
		for (const op of deletes) {
			const a = op.after!;
			switch (op.entity) {
				case 'dependency': {
					const dep = await tx.select().from(dependencies).where(eq(dependencies.id, a.id as string)).then((r) => r[0]);
					if (!dep) continue;
					await tx.delete(dependencies).where(eq(dependencies.id, dep.id));
					await log(op, dep, null);
					break;
				}
				case 'stage_link': {
					const w = and(eq(stageLinks.fromStageId, a.fromStageId as string), eq(stageLinks.toStageId, a.toStageId as string));
					const link = await tx.select().from(stageLinks).where(w).then((r) => r[0]);
					if (!link) continue;
					await tx.delete(stageLinks).where(w);
					await log(op, link, null);
					break;
				}
				case 'skip': {
					const w = and(eq(bookStageSkips.bookId, a.bookId as string), eq(bookStageSkips.stageId, a.stageId as string));
					const skip = await tx.select().from(bookStageSkips).where(w).then((r) => r[0]);
					if (!skip) continue;
					await tx.delete(bookStageSkips).where(w);
					await log(op, skip, null);
					break;
				}
				case 'task': {
					const bundle = await taskBundle(tx, op.id);
					if (!bundle) continue;
					await deleteTask(tx, op.id);
					await log(op, bundle, null);
					changed.push(op.id);
					break;
				}
				case 'book': {
					const id = ((a.book ?? a) as Json).id as string;
					const book = await tx.select().from(books).where(eq(books.id, id)).then((r) => r[0]);
					if (!book) continue;
					const own = await tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.bookId, id));
					const taskBundles: TaskBundle[] = [];
					for (const t of own) {
						const tb = await taskBundle(tx, t.id);
						if (tb) taskBundles.push(tb);
						await deleteTask(tx, t.id);
					}
					const skips = await tx.select().from(bookStageSkips).where(eq(bookStageSkips.bookId, id));
					const printRecord = await tx.select().from(printRecords).where(eq(printRecords.bookId, id)).then((r) => r[0] ?? null);
					await tx.delete(bookStageSkips).where(eq(bookStageSkips.bookId, id));
					await tx.delete(printRecords).where(eq(printRecords.bookId, id));
					await tx.delete(books).where(eq(books.id, id));
					await log(op, { book, skips, printRecord, tasks: taskBundles }, null);
					break;
				}
				case 'stage': {
					const id = ((a.stage ?? a) as Json).id as string;
					const stage = await tx.select().from(stages).where(eq(stages.id, id)).then((r) => r[0]);
					if (!stage) continue;
					const st = await tx.select().from(stageTracks).where(eq(stageTracks.stageId, id));
					const skips = await tx.select().from(bookStageSkips).where(eq(bookStageSkips.stageId, id));
					await tx.delete(bookStageSkips).where(eq(bookStageSkips.stageId, id));
					await tx.delete(stageTracks).where(eq(stageTracks.stageId, id));
					await tx.delete(stages).where(eq(stages.id, id));
					await log(op, { stage, stageTracks: st, skips }, null);
					break;
				}
				case 'track': {
					const id = ((a.track ?? a) as Json).id as string;
					const track = await tx.select().from(tracks).where(eq(tracks.id, id)).then((r) => r[0]);
					if (!track) continue;
					const st = await tx.select().from(stageTracks).where(eq(stageTracks.trackId, id));
					await tx.delete(stageTracks).where(eq(stageTracks.trackId, id));
					await tx.delete(tracks).where(eq(tracks.id, id));
					await log(op, { track, stageTracks: st }, null);
					break;
				}
				case 'window': {
					const w = await tx.select().from(windows).where(eq(windows.id, op.id)).then((r) => r[0]);
					if (!w) continue;
					await tx.delete(windows).where(eq(windows.id, op.id));
					await log(op, w, null);
					break;
				}
				case 'holiday': {
					const h = await tx.select().from(holidays).where(eq(holidays.date, op.id)).then((r) => r[0]);
					if (!h) continue;
					await tx.delete(holidays).where(eq(holidays.date, op.id));
					await log(op, h, null);
					break;
				}
			}
		}

		// Window sort order follows dates.
		if (seriesId && ops.some((o) => o.entity === 'window')) {
			const rows = await tx.select({ id: windows.id }).from(windows).where(eq(windows.seriesId, seriesId)).orderBy(windows.startDate);
			for (const [i, r] of rows.entries()) await tx.update(windows).set({ sortOrder: i + 1 }).where(eq(windows.id, r.id));
		}
	});

	const restored = changed.length ? await db.select().from(tasks).where(inArray(tasks.id, [...new Set(changed)])) : [];
	return { ok: true as const, batchId, restored };
}
