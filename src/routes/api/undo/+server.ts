import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { ulid } from 'ulid';
import { db } from '#lib/server/db/index.ts';
import { activityLog, series, tasks } from '#lib/server/db/schema.ts';
import { asc, eq } from 'drizzle-orm';
import { parseBody, resolvePerson } from '#lib/server/api-auth.ts';

type Body = { batchId: string; seriesId: string };

const TASK_FIELDS = ['startDate', 'endDate', 'durationDays', 'windowId', 'scheduleState', 'overflowAllowed'] as const;

// POST /api/undo — reverse one batch: task placements, and series settings changed with them.
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

	// Series settings changed in the batch must still hold the values the batch set.
	const seriesEntries = entries.filter(e => e.entity === 'series' && e.beforeJson && e.afterJson);
	const seriesConflicts: string[] = [];
	for (const entry of seriesEntries) {
		const after = JSON.parse(entry.afterJson!) as Record<string, unknown>;
		const current = await db.select().from(series).where(eq(series.id, entry.entityId)).then(r => r[0]);
		if (!current) continue;
		for (const [k, v] of Object.entries(after))
			if (current[k as keyof typeof current] !== v) seriesConflicts.push(k);
	}

	if (conflicting.length > 0 || seriesConflicts.length > 0) {
		return json({ error: 'conflict', taskIds: conflicting, seriesFields: seriesConflicts }, { status: 409 });
	}

	const now       = new Date().toISOString();
	const undoBatch = ulid();
	const restored: Record<string, unknown>[] = [];

	await db.transaction(async tx => {
		for (const entry of seriesEntries) {
			const before = JSON.parse(entry.beforeJson!);
			const after = JSON.parse(entry.afterJson!);
			await tx.update(series).set(before).where(eq(series.id, entry.entityId));
			await tx.insert(activityLog).values({
				id: ulid(), seriesId: batchSeriesId, actorId: personId,
				entity: 'series', entityId: entry.entityId, action: 'undo',
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
	});

	return json({ restored, undoBatchId: undoBatch });
};
