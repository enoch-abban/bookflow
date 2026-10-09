import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { ulid } from 'ulid';
import { eq } from 'drizzle-orm';
import { db, writeAll, type Write } from '#lib/server/db/index.ts';
import { activityLog, series } from '#lib/server/db/schema.ts';
import { parseBody, requireCoord } from '#lib/server/api-auth.ts';
import { parseOr400, updateSeriesSchema } from '#lib/server/validation.ts';
import { loadSeriesContext } from '#lib/server/series-context.ts';
import { refit } from '#lib/server/refit.ts';
import { refitChanges, refitReport, taskChangeQueries } from '#lib/server/schedule-write.ts';

type SeriesRow = typeof series.$inferSelect;

// PATCH /api/series/:id — series settings. Existing print records are not touched.
// Changing window enforcement or the overflow allowance refits the schedule
// (spec: Changing windows); with `preview` the impact is returned without saving.
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const { personId } = await requireCoord(locals, params.id);
	const { preview, ...body } = parseOr400(updateSeriesSchema, await parseBody(request));

	const before = await db.select().from(series).where(eq(series.id, params.id)).then((r) => r[0]);
	if (!before) throw error(404, 'Series not found');

	const patch: Partial<SeriesRow> = {};
	if (body.name !== undefined) patch.name = body.name;
	if (body.targetDate !== undefined) patch.targetDate = body.targetDate;
	if (body.hardLimitDate !== undefined) patch.hardLimitDate = body.hardLimitDate;
	if (body.status !== undefined) patch.status = body.status;
	if (body.bookGroupLabel !== undefined) patch.bookGroupLabel = body.bookGroupLabel;
	if (body.enforceWindows !== undefined) patch.enforceWindows = body.enforceWindows ? 1 : 0;
	if (body.strictMode !== undefined) patch.strictMode = body.strictMode ? 1 : 0;
	if (body.defaultCopies !== undefined) patch.defaultCopies = body.defaultCopies;
	if (body.legalDepositCopies !== undefined) patch.legalDepositCopies = body.legalDepositCopies;
	if (body.printBufferDays !== undefined) patch.printBufferDays = body.printBufferDays;
	if (body.windowOverflowDays !== undefined) patch.windowOverflowDays = body.windowOverflowDays;

	const after = { ...before, ...patch };
	if (after.targetDate < after.startDate) throw error(400, 'The target date cannot be before the series starts.');
	if (after.hardLimitDate && after.hardLimitDate < after.targetDate)
		throw error(400, 'The hard limit cannot be before the target date.');

	const changed = Object.fromEntries(
		(Object.keys(patch) as (keyof SeriesRow)[]).filter((k) => patch[k] !== before[k]).map((k) => [k, patch[k]])
	);

	// Window rules changed: re-place tasks under the new rules.
	const needsRefit = 'enforceWindows' in changed || 'windowOverflowDays' in changed;
	const ctx = needsRefit ? await loadSeriesContext(before.id) : null;
	const original = ctx ? new Map([...ctx.taskMap].map(([k, v]) => [k, { ...v }])) : null;
	const result = ctx
		? refit(ctx.taskMap, ctx.depList, { enforce: !!after.enforceWindows, windows: ctx.windows, overflowDays: after.windowOverflowDays })
		: null;
	const report = ctx && result ? refitReport(ctx, original!, result) : null;

	if (preview) return json({ preview: true, series: after, report });
	if (!Object.keys(changed).length) return json({ series: before, report: null });

	const batchId = ulid();
	const now = new Date().toISOString();
	// One round trip: the settings, their log entry and any refit, all or nothing.
	const queries: Write[] = [
		db.update(series).set(changed).where(eq(series.id, before.id)).returning(),
		db.insert(activityLog).values({
			id: ulid(), seriesId: before.id, actorId: personId,
			entity: 'series', entityId: before.id, action: 'update',
			beforeJson: JSON.stringify(Object.fromEntries(Object.keys(changed).map((k) => [k, before[k as keyof SeriesRow]]))),
			afterJson: JSON.stringify(changed),
			batchId, createdAt: now,
		}),
	];
	if (result?.changes.length)
		queries.push(...taskChangeQueries({ seriesId: before.id, actorId: personId, batchId, now, original: original!, changes: refitChanges(result) }).queries);
	const [rows] = await writeAll(queries);
	const updated = (rows as SeriesRow[])[0];

	return json({ series: updated, report, batchId });
};
