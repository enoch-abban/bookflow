import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { ulid } from 'ulid';
import { db } from '#lib/server/db/index.ts';
import { activityLog, series, stages, tasks, windows } from '#lib/server/db/schema.ts';
import { asc, eq } from 'drizzle-orm';
import { parseBody, resolvePerson } from '#lib/server/api-auth.ts';

type Body = { batchId: string; seriesId: string };

const TASK_FIELDS = ['startDate', 'endDate', 'durationDays', 'windowId', 'scheduleState', 'overflowAllowed', 'dueDate'] as const;

// Settings rows a batch can change alongside its tasks; restored field by field.
const SETTING_TABLES = { series, stage: stages } as const;
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
	const taskEntries = entries.filter(e => e.entity === 'task' && e.beforeJson);
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

	if (conflicting.length > 0 || seriesConflicts.length > 0 || windowConflicts.length > 0) {
		return json({ error: 'conflict', taskIds: conflicting, seriesFields: seriesConflicts, windowIds: windowConflicts }, { status: 409 });
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
