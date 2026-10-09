import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { activityLog } from '#lib/server/db/schema.ts';
import { parseBody, resolvePerson } from '#lib/server/api-auth.ts';
import { batchKind } from '#lib/activity/describe.ts';
import { redoRefusal, reversals, stepConflict } from '#lib/server/history.ts';
import { reverseStep } from '#lib/server/reapply.ts';

// POST /api/redo { batchId } — reapply a change by reversing the undo batch that removed it.
// Only the person who undid it can redo it; refused, with the tasks named, if anything the
// undo touched has changed since.
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await parseBody<{ batchId: string }>(request);
	if (!body.batchId) throw error(400, 'batchId required');
	const { personId, systemRole } = await resolvePerson(locals);

	const entries = await db.select().from(activityLog).where(eq(activityLog.batchId, body.batchId)).orderBy(asc(activityLog.id));
	if (!entries.length) throw error(404, 'Batch not found');

	const kind = batchKind(entries.map((e) => ({ ...e, before: null, after: null })));
	const reversed = (await reversals([body.batchId])).has(body.batchId);
	const touchesHolidays = entries.some((e) => e.entity === 'holiday');
	const refusal = redoRefusal({ actorId: entries[0].actorId, kind, reversed, holidays: touchesHolidays }, { personId, systemRole });
	if (refusal) throw error(reversed ? 409 : 403, refusal);

	const res = await reverseStep({ sourceBatchId: body.batchId, entries, actorId: personId, action: 'redo' });
	if (!res.ok) return stepConflict(entries.find((e) => e.seriesId)?.seriesId ?? null, res.taskIds, res.other);
	return json({ restored: res.restored, redoBatchId: res.batchId });
};
