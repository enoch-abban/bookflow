import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { ulid } from 'ulid';
import { db } from '#lib/server/db/index.ts';
import { activityLog, baselineTasks, books, bookStageSkips, dependencies, printRecords, series, stageLinks, stageTracks, stages, taskAssignees, taskComments, tasks, tracks, windows } from '#lib/server/db/schema.ts';
import { and, asc, eq, inArray, or } from 'drizzle-orm';
import { parseBody, resolvePerson } from '#lib/server/api-auth.ts';

type Body = { batchId: string; seriesId: string };

const TASK_FIELDS = ['startDate', 'endDate', 'durationDays', 'windowId', 'scheduleState', 'overflowAllowed', 'dueDate'] as const;

// Settings rows a batch can change alongside its tasks; restored field by field.
const SETTING_TABLES = { series, stage: stages, book: books } as const;
type SettingEntity = keyof typeof SETTING_TABLES;
const isSetting = (entity: string): entity is SettingEntity => entity in SETTING_TABLES;

// POST /api/undo — reverse one batch: task placements and due dates, and the series, stage
// and window settings changed with them.
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await parseBody<Body>(request);
	if (!body.batchId) throw error(400, 'batchId required');

	const { personId, isAdmin } = await resolvePerson(locals);

	// Load all log entries for this batch, oldest first
	const entries = await db.select()
		.from(activityLog)
		.where(eq(activityLog.batchId, body.batchId))
		.orderBy(asc(activityLog.id));

	if (!entries.length) throw error(404, 'Batch not found');

	const batchSeriesId = entries[0].seriesId!;

	// Permission: actor undoing their own batch, or admin undoing any
	const actorId = entries[0].actorId;
	if (!isAdmin && actorId !== personId) {
		throw error(403, 'You can only undo your own batches');
	}

	// If not admin, check within-last-50-batches limit (approximate via log ordering)
	// For MVP we skip the strict 50-batch window check

	// A task can appear more than once in a batch (e.g. an overflow switch, then its refit):
	// each field is restored from the earliest entry that recorded it, and the task must
	// still be at the version its last entry produced.
	// Rows the batch created or deleted outright are handled separately below.
	const taskEntries = entries.filter(e => e.entity === 'task' && e.beforeJson && e.action !== 'delete');
	const perTask = new Map<string, { before: Record<string, unknown>; expectedVersion: number }>();
	for (const entry of taskEntries) {
		const before = JSON.parse(entry.beforeJson!);
		const prev = perTask.get(entry.entityId);
		const expectedVersion = Math.max(prev?.expectedVersion ?? 0, (before.version ?? 0) + 1);
		perTask.set(entry.entityId, { before: { ...before, ...prev?.before }, expectedVersion });
	}

	const conflicting: string[] = [];
	for (const [taskId, { expectedVersion }] of perTask) {
		const current = await db.select({ version: tasks.version })
			.from(tasks).where(eq(tasks.id, taskId)).then(r => r[0]);
		if (current && current.version !== expectedVersion) conflicting.push(taskId);
	}

	// Series and stage settings changed in the batch must still hold the values the batch set.
	const seriesEntries = entries.filter(e => isSetting(e.entity) && e.beforeJson && e.afterJson);
	const seriesConflicts: string[] = [];
	for (const entry of seriesEntries) {
		const table = SETTING_TABLES[entry.entity as SettingEntity];
		const after = JSON.parse(entry.afterJson!) as Record<string, unknown>;
		const current = await db.select().from(table).where(eq(table.id, entry.entityId)).then(r => r[0] as Record<string, unknown> | undefined);
		if (!current) continue;
		for (const [k, v] of Object.entries(after))
			if (current[k] !== v) seriesConflicts.push(`${entry.entity}.${k}`);
	}

	// Windows changed in the batch must still be as the batch left them.
	const windowEntries = entries.filter(e => e.entity === 'window');
	const windowConflicts: string[] = [];
	for (const entry of windowEntries) {
		const current = await db.select().from(windows).where(eq(windows.id, entry.entityId)).then(r => r[0] ?? null);
		const after = entry.afterJson ? JSON.parse(entry.afterJson) as typeof windows.$inferSelect : null;
		const before = entry.beforeJson ? JSON.parse(entry.beforeJson) as typeof windows.$inferSelect : null;
		if (after && (!current || current.label !== after.label || current.startDate !== after.startDate || current.endDate !== after.endDate))
			windowConflicts.push(entry.entityId);
		if (!after && current) windowConflicts.push(entry.entityId);
		// A restored or reverted window must not collide with windows added since.
		if (before) {
			const others = await db.select().from(windows).where(eq(windows.seriesId, before.seriesId));
			if (others.some(w => w.id !== before.id && w.startDate <= before.endDate && before.startDate <= w.endDate))
				windowConflicts.push(entry.entityId);
		}
		// A window the batch created can only go if nothing outside the batch has moved into it.
		if (after && !before) {
			const users = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.windowId, after.id));
			if (users.some(t => !perTask.has(t.id))) windowConflicts.push(entry.entityId);
		}
	}

	// A book the batch added can only go while it and its tasks are untouched, and no task
	// of another book has been linked to it since.
	const bookCreates = entries.filter(e => e.entity === 'book' && e.action === 'create');
	const bookConflicts: string[] = [];
	const createdBookTasks = new Map<string, string[]>();
	for (const entry of bookCreates) {
		const book = await db.select().from(books).where(eq(books.id, entry.entityId)).then(r => r[0]);
		if (!book) continue;
		const own = await db.select({ id: tasks.id, version: tasks.version }).from(tasks).where(eq(tasks.bookId, book.id));
		const ids = own.map(t => t.id);
		createdBookTasks.set(book.id, ids);
		const links = ids.length
			? await db.select().from(dependencies).where(or(inArray(dependencies.predecessorId, ids), inArray(dependencies.successorId, ids)))
			: [];
		if (book.version !== 1 || own.some(t => t.version !== 1) || links.some(d => !ids.includes(d.predecessorId) || !ids.includes(d.successorId)))
			bookConflicts.push(book.code);
	}

	// Tasks, dependencies and skips the batch created or deleted (skipping a stage, lifting
	// a skip, adding a dependency). Deleted rows come back; created ones go, provided a
	// created task is still untouched and a deleted one has not reappeared.
	const ROW_ENTITIES = ['task', 'dependency', 'skip', 'stage_link'];
	// Removed books and stages come back before their tasks, which point at them.
	const rowDeletes = entries
		.filter(e => [...ROW_ENTITIES, 'book', 'stage'].includes(e.entity) && e.action === 'delete' && e.beforeJson)
		.sort((a, b) => Number(['stage', 'book'].includes(b.entity)) - Number(['stage', 'book'].includes(a.entity)));
	const rowCreates = entries.filter(e => ROW_ENTITIES.includes(e.entity) && e.action === 'create' && e.afterJson);
	for (const entry of rowDeletes.filter(e => e.entity === 'task')) {
		const back = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, entry.entityId));
		if (back.length) conflicting.push(entry.entityId);
	}
	for (const entry of rowCreates.filter(e => e.entity === 'task')) {
		const current = await db.select({ version: tasks.version }).from(tasks).where(eq(tasks.id, entry.entityId)).then(r => r[0]);
		if (current && current.version !== 1) conflicting.push(entry.entityId);
	}

	// Print records the batch changed (Apply to all books) must still be at the version it left.
	const recordEntries = entries.filter(e => e.entity === 'print_record' && e.beforeJson && e.afterJson);
	for (const entry of recordEntries) {
		const after = JSON.parse(entry.afterJson!);
		const current = await db.select({ version: printRecords.version }).from(printRecords).where(eq(printRecords.bookId, entry.entityId)).then(r => r[0]);
		if (current && current.version !== after.version) bookConflicts.push('a print record changed since');
	}

	// A stage the batch added can go only if it has no tasks the batch did not create;
	// a track the batch created, only while no book follows it.
	const stageCreates = entries.filter(e => e.entity === 'stage' && e.action === 'create');
	const trackCreates = entries.filter(e => e.entity === 'track' && e.action === 'create');
	const trackDeletes = entries.filter(e => e.entity === 'track' && e.action === 'delete' && e.beforeJson);
	const createdTaskIds = new Set(rowCreates.filter(e => e.entity === 'task').map(e => e.entityId));
	for (const entry of stageCreates) {
		const others = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.stageId, entry.entityId));
		if (others.some(t => !createdTaskIds.has(t.id))) bookConflicts.push(`the new stage's tasks`);
	}
	for (const entry of trackCreates) {
		const users = await db.select({ id: books.id }).from(books).where(eq(books.trackId, entry.entityId));
		if (users.length) bookConflicts.push('a book now on the new track');
	}

	if (conflicting.length > 0 || seriesConflicts.length > 0 || windowConflicts.length > 0 || bookConflicts.length > 0) {
		return json({
			error: 'conflict', taskIds: conflicting, seriesFields: seriesConflicts, windowIds: windowConflicts, books: bookConflicts,
			message: bookConflicts.length ? `${bookConflicts.join(', ')} changed since; it can no longer be undone.` : undefined,
		}, { status: 409 });
	}

	const now       = new Date().toISOString();
	const undoBatch = ulid();
	const restored: Record<string, unknown>[] = [];

	const logWindow = (tx: Parameters<Parameters<typeof db.transaction>[0]>[0], entityId: string, from: unknown, to: unknown) =>
		tx.insert(activityLog).values({
			id: ulid(), seriesId: batchSeriesId, actorId: personId,
			entity: 'window', entityId, action: 'undo',
			beforeJson: from ? JSON.stringify(from) : null, afterJson: to ? JSON.stringify(to) : null,
			batchId: undoBatch, createdAt: now,
		});

	await db.transaction(async tx => {
		// Windows first (recreate deleted, revert changed), so restored tasks can point at them.
		for (const entry of windowEntries) {
			const before = entry.beforeJson ? JSON.parse(entry.beforeJson) : null;
			const after = entry.afterJson ? JSON.parse(entry.afterJson) : null;
			if (before && !after) await tx.insert(windows).values(before);
			if (before && after) await tx.update(windows).set({ label: before.label, startDate: before.startDate, endDate: before.endDate }).where(eq(windows.id, before.id));
			if (before) await logWindow(tx, entry.entityId, after, before);
		}

		// Deleted rows come back: tasks (with assignees) first, then their links and skips.
		const logRow = (entity: 'task' | 'dependency' | 'skip', entityId: string, from: unknown, to: unknown) =>
			tx.insert(activityLog).values({
				id: ulid(), seriesId: batchSeriesId, actorId: personId, entity, entityId, action: 'undo',
				beforeJson: from ? JSON.stringify(from) : null, afterJson: to ? JSON.stringify(to) : null,
				batchId: undoBatch, createdAt: now,
			});
		const deletedDeps: (typeof dependencies.$inferSelect)[] = [];
		for (const entry of rowDeletes) {
			const before = JSON.parse(entry.beforeJson!);
			if (entry.entity === 'stage') {
				await tx.insert(stages).values(before.stage).onConflictDoNothing();
				if (before.stageTracks?.length) await tx.insert(stageTracks).values(before.stageTracks).onConflictDoNothing();
				if (before.skips?.length) await tx.insert(bookStageSkips).values(before.skips).onConflictDoNothing();
				await tx.insert(activityLog).values({ id: ulid(), seriesId: batchSeriesId, actorId: personId, entity: 'stage', entityId: entry.entityId, action: 'undo', afterJson: JSON.stringify(before.stage), batchId: undoBatch, createdAt: now });
			} else if (entry.entity === 'book') {
				await tx.insert(books).values(before.book).onConflictDoNothing();
				if (before.skips?.length) await tx.insert(bookStageSkips).values(before.skips).onConflictDoNothing();
				if (before.printRecord) await tx.insert(printRecords).values(before.printRecord).onConflictDoNothing();
				await tx.insert(activityLog).values({ id: ulid(), seriesId: batchSeriesId, actorId: personId, entity: 'book', entityId: entry.entityId, action: 'undo', afterJson: JSON.stringify(before.book), batchId: undoBatch, createdAt: now });
			} else if (entry.entity === 'stage_link') {
				await tx.insert(stageLinks).values(before).onConflictDoNothing();
				await tx.insert(activityLog).values({ id: ulid(), seriesId: batchSeriesId, actorId: personId, entity: 'stage_link', entityId: entry.entityId, action: 'undo', afterJson: JSON.stringify(before), batchId: undoBatch, createdAt: now });
			} else if (entry.entity === 'task') {
				await tx.insert(tasks).values(before.task);
				if (before.assignees?.length) await tx.insert(taskAssignees).values(before.assignees);
				if (before.baseline?.length) await tx.insert(baselineTasks).values(before.baseline).onConflictDoNothing();
				if (before.comments?.length) await tx.insert(taskComments).values(before.comments).onConflictDoNothing();
				deletedDeps.push(...(before.dependencies ?? []));
				await logRow('task', entry.entityId, null, before.task);
			} else if (entry.entity === 'dependency') {
				deletedDeps.push(before);
			} else {
				await tx.insert(bookStageSkips).values(before).onConflictDoNothing();
				await logRow('skip', entry.entityId, null, before);
			}
		}
		const createdDepIds = new Set<string>(rowCreates.filter(e => e.entity === 'dependency').map(e => JSON.parse(e.afterJson!).id).filter(Boolean));
		for (const dep of deletedDeps) {
			await tx.insert(dependencies).values(dep).onConflictDoNothing();
			await logRow('dependency', dep.id, null, dep);
		}

		for (const entry of seriesEntries) {
			const before = JSON.parse(entry.beforeJson!);
			const after = JSON.parse(entry.afterJson!);
			const table = SETTING_TABLES[entry.entity as SettingEntity];
			await tx.update(table).set(before).where(eq(table.id, entry.entityId));
			await tx.insert(activityLog).values({
				id: ulid(), seriesId: batchSeriesId, actorId: personId,
				entity: entry.entity as SettingEntity, entityId: entry.entityId, action: 'undo',
				beforeJson: JSON.stringify(after), afterJson: JSON.stringify(before),
				batchId: undoBatch, createdAt: now,
			});
		}

		for (const [taskId, { before }] of perTask) {
			const current = await tx.select().from(tasks).where(eq(tasks.id, taskId)).then(r => r[0]);
			if (!current) continue;

			// Restore only scheduling fields; keep the current status and notes.
			const restoreFields: Record<string, unknown> = {};
			for (const f of TASK_FIELDS) if (before[f] !== undefined) restoreFields[f] = before[f];
			const prior = Object.fromEntries(Object.keys(restoreFields).map(f => [f, current[f as keyof typeof current]]));

			restoreFields.version   = current.version + 1;
			restoreFields.updatedAt = now;
			await tx.update(tasks).set(restoreFields).where(eq(tasks.id, taskId));

			await tx.insert(activityLog).values({
				id:         ulid(),
				seriesId:   batchSeriesId,
				actorId:    personId,
				entity:     'task',
				entityId:   taskId,
				action:     'undo',
				beforeJson: JSON.stringify({ ...prior, version: current.version }),
				afterJson:  JSON.stringify(restoreFields),
				batchId:    undoBatch,
				createdAt:  now,
			});

			restored.push({ id: taskId, ...restoreFields });
		}

		// Created rows go: links first, then tasks (with anything linked to them), then skips.
		for (const id of createdDepIds) {
			const dep = await tx.select().from(dependencies).where(eq(dependencies.id, id)).then(r => r[0]);
			if (!dep) continue;
			await tx.delete(dependencies).where(eq(dependencies.id, id));
			await logRow('dependency', id, dep, null);
		}
		for (const entry of rowCreates.filter(e => e.entity === 'task')) {
			const task = await tx.select().from(tasks).where(eq(tasks.id, entry.entityId)).then(r => r[0]);
			if (!task) continue;
			await tx.delete(dependencies).where(or(eq(dependencies.predecessorId, task.id), eq(dependencies.successorId, task.id)));
			await tx.delete(taskAssignees).where(eq(taskAssignees.taskId, task.id));
			await tx.delete(tasks).where(eq(tasks.id, task.id));
			await logRow('task', task.id, task, null);
		}
		for (const entry of rowCreates.filter(e => e.entity === 'stage_link')) {
			const link = JSON.parse(entry.afterJson!);
			await tx.delete(stageLinks).where(and(eq(stageLinks.fromStageId, link.fromStageId), eq(stageLinks.toStageId, link.toStageId)));
			await tx.insert(activityLog).values({ id: ulid(), seriesId: batchSeriesId, actorId: personId, entity: 'stage_link', entityId: entry.entityId, action: 'undo', beforeJson: JSON.stringify(link), batchId: undoBatch, createdAt: now });
		}
		for (const entry of rowCreates.filter(e => e.entity === 'skip')) {
			const skip = JSON.parse(entry.afterJson!);
			await tx.delete(bookStageSkips).where(and(eq(bookStageSkips.bookId, skip.bookId), eq(bookStageSkips.stageId, skip.stageId)));
			await logRow('skip', entry.entityId, skip, null);
		}

		for (const entry of recordEntries) {
			const before = JSON.parse(entry.beforeJson!);
			const current = await tx.select().from(printRecords).where(eq(printRecords.bookId, entry.entityId)).then(r => r[0]);
			if (!current) continue;
			const fields = Object.fromEntries(Object.entries(before).filter(([k]) => k !== 'version'));
			await tx.update(printRecords).set({ ...fields, version: current.version + 1, updatedAt: now }).where(eq(printRecords.bookId, entry.entityId));
			await tx.insert(activityLog).values({ id: ulid(), seriesId: batchSeriesId, actorId: personId, entity: 'print_record', entityId: entry.entityId, action: 'undo', beforeJson: entry.afterJson, afterJson: JSON.stringify(fields), batchId: undoBatch, createdAt: now });
		}

		// Stages and tracks the batch added go once their tasks have; deleted tracks come back.
		for (const entry of stageCreates) {
			await tx.delete(bookStageSkips).where(eq(bookStageSkips.stageId, entry.entityId));
			await tx.delete(stageTracks).where(eq(stageTracks.stageId, entry.entityId));
			await tx.delete(stages).where(eq(stages.id, entry.entityId));
			await tx.insert(activityLog).values({ id: ulid(), seriesId: batchSeriesId, actorId: personId, entity: 'stage', entityId: entry.entityId, action: 'undo', beforeJson: entry.afterJson, batchId: undoBatch, createdAt: now });
		}
		for (const entry of trackCreates) {
			await tx.delete(stageTracks).where(eq(stageTracks.trackId, entry.entityId));
			await tx.delete(tracks).where(eq(tracks.id, entry.entityId));
			await tx.insert(activityLog).values({ id: ulid(), seriesId: batchSeriesId, actorId: personId, entity: 'track', entityId: entry.entityId, action: 'undo', beforeJson: entry.afterJson, batchId: undoBatch, createdAt: now });
		}
		for (const entry of trackDeletes) {
			const before = JSON.parse(entry.beforeJson!);
			await tx.insert(tracks).values(before.track).onConflictDoNothing();
			if (before.stageTracks?.length) await tx.insert(stageTracks).values(before.stageTracks).onConflictDoNothing();
			await tx.insert(activityLog).values({ id: ulid(), seriesId: batchSeriesId, actorId: personId, entity: 'track', entityId: entry.entityId, action: 'undo', afterJson: JSON.stringify(before.track), batchId: undoBatch, createdAt: now });
		}

		// Books the batch added go, with everything created for them.
		for (const [bookId, ids] of createdBookTasks) {
			if (ids.length) {
				await tx.delete(dependencies).where(or(inArray(dependencies.predecessorId, ids), inArray(dependencies.successorId, ids)));
				await tx.delete(taskAssignees).where(inArray(taskAssignees.taskId, ids));
				await tx.delete(tasks).where(inArray(tasks.id, ids));
			}
			await tx.delete(bookStageSkips).where(eq(bookStageSkips.bookId, bookId));
			await tx.delete(printRecords).where(eq(printRecords.bookId, bookId));
			await tx.delete(books).where(eq(books.id, bookId));
			await tx.insert(activityLog).values({
				id: ulid(), seriesId: batchSeriesId, actorId: personId, entity: 'book', entityId: bookId, action: 'undo',
				beforeJson: JSON.stringify({ tasks: ids.length }), batchId: undoBatch, createdAt: now,
			});
		}

		// Windows the batch created go last, once no restored task points at them.
		for (const entry of windowEntries) {
			if (entry.beforeJson || !entry.afterJson) continue;
			await tx.delete(windows).where(eq(windows.id, entry.entityId));
			await logWindow(tx, entry.entityId, JSON.parse(entry.afterJson), null);
		}

		// Keep window sort order by date.
		if (windowEntries.length) {
			const rows = await tx.select({ id: windows.id }).from(windows).where(eq(windows.seriesId, batchSeriesId)).orderBy(asc(windows.startDate));
			for (const [i, r] of rows.entries()) await tx.update(windows).set({ sortOrder: i + 1 }).where(eq(windows.id, r.id));
		}
	});

	return json({ restored, undoBatchId: undoBatch });
};
