import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { activityLog, series } from '#lib/server/db/schema.ts';
import { parseBody, resolvePerson } from '#lib/server/api-auth.ts';
import { batchKind } from '#lib/activity/describe.ts';
import { redoRefusal, reversals, stepConflict } from '#lib/server/history.ts';
import { reverseStep } from '#lib/server/reapply.ts';
import { loadPlan } from '#lib/server/series-context.ts';
import { assertStrict } from '#lib/server/strict.ts';

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

	// Strict mode: redo is a deliberate change made again, and the plan may have moved on
	// since the undo (a task may have started), so its result passes the same check.
	const seriesId = entries.find((e) => e.seriesId)?.seriesId ?? null;
	const ser = seriesId ? await db.select({ strictMode: series.strictMode }).from(series).where(eq(series.id, seriesId)).then((r) => r[0]) : null;
	const before = ser?.strictMode ? await loadPlan(db, seriesId!) : null;
	const check = before
		? async (tx: Parameters<typeof loadPlan>[0]) => {
			const after = await loadPlan(tx, seriesId!);
			assertStrict({ series: ser!, labels: new Map([...before.labels, ...after.labels]) }, before, after);
		}
		: undefined;

	const res = await reverseStep({ sourceBatchId: body.batchId, entries, actorId: personId, action: 'redo', check });
	if (!res.ok) return stepConflict(entries.find((e) => e.seriesId)?.seriesId ?? null, res.taskIds, res.other);
	return json({ restored: res.restored, redoBatchId: res.batchId });
};
