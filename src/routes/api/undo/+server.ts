import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { ulid } from 'ulid';
import { db } from '#lib/server/db/index.ts';
import { activityLog, tasks, people, seriesMembers } from '#lib/server/db/schema.ts';
import { and, eq } from 'drizzle-orm';
import { parseBody, resolvePerson } from '#lib/server/api-auth.ts';

type Body = { batchId: string; seriesId: string };

// POST /api/undo
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await parseBody<Body>(request);
	if (!body.batchId) throw error(400, 'batchId required');

	const { personId, isAdmin } = await resolvePerson(locals);

	// Load all log entries for this batch
	const entries = await db.select()
		.from(activityLog)
		.where(eq(activityLog.batchId, body.batchId));

	if (!entries.length) throw error(404, 'Batch not found');

	const batchSeriesId = entries[0].seriesId!;

	// Permission: actor undoing their own batch, or admin undoing any
	const actorId = entries[0].actorId;
	if (!isAdmin && actorId !== personId) {
		throw error(403, 'You can only undo your own batches');
	}

	// If not admin, check within-last-50-batches limit (approximate via log ordering)
	// For MVP we skip the strict 50-batch window check

	// For each task entry with beforeJson, check current version
	const taskEntries = entries.filter(e => e.entity === 'task' && e.beforeJson);
	const conflicting: string[] = [];

	for (const entry of taskEntries) {
		const before = JSON.parse(entry.beforeJson!);
		const current = await db.select({ version: tasks.version })
			.from(tasks).where(eq(tasks.id, entry.entityId)).then(r => r[0]);
		if (!current) continue;
		// The original version we saved as beforeJson.version
		if (before.version !== undefined && current.version !== before.version + 1) {
			conflicting.push(entry.entityId);
		}
	}

	if (conflicting.length > 0) {
		return json({ error: 'conflict', taskIds: conflicting }, { status: 409 });
	}

	// Restore task dates / status from beforeJson
	const now       = new Date().toISOString();
	const undoBatch = ulid();
	const restored: { id: string; startDate: string; endDate: string; version: number }[] = [];

	await db.transaction(async tx => {
		for (const entry of taskEntries) {
			const before = JSON.parse(entry.beforeJson!);
			const current = await tx.select().from(tasks).where(eq(tasks.id, entry.entityId)).then(r => r[0]);
			if (!current) continue;

			// Restore only scheduling fields from before; preserve current status/notes
			const restoreFields: Record<string, unknown> = {};
			if (before.startDate)    restoreFields.startDate    = before.startDate;
			if (before.endDate)      restoreFields.endDate      = before.endDate;
			if (before.durationDays) restoreFields.durationDays = before.durationDays;
			if (before.windowId !== undefined) restoreFields.windowId = before.windowId;

			restoreFields.version   = current.version + 1;
			restoreFields.updatedAt = now;

			await tx.update(tasks).set(restoreFields).where(eq(tasks.id, entry.entityId));

			await tx.insert(activityLog).values({
				id:         ulid(),
				seriesId:   batchSeriesId,
				actorId:    personId,
				entity:     'task',
				entityId:   entry.entityId,
				action:     'undo',
				beforeJson: JSON.stringify({ startDate: current.startDate, endDate: current.endDate }),
				afterJson:  JSON.stringify({ startDate: before.startDate, endDate: before.endDate }),
				batchId:    undoBatch,
				createdAt:  now,
			});

			restored.push({
				id:           entry.entityId,
				startDate:    before.startDate ?? current.startDate,
				endDate:      before.endDate   ?? current.endDate,
				version:      current.version + 1,
			});
		}
	});

	return json({ restored, undoBatchId: undoBatch });
};
