import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { ulid } from 'ulid';
import { and, count, eq, gt, isNull } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { activityLog, books, series, stages, tasks } from '#lib/server/db/schema.ts';
import { parseBody, requireCoord } from '#lib/server/api-auth.ts';
import { parseOr400, updateSeriesSchema } from '#lib/server/validation.ts';

type SeriesRow = typeof series.$inferSelect;

// PATCH /api/series/:id — series settings. Existing print records are not touched.
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const { personId } = await requireCoord(locals, params.id);
	const body = parseOr400(updateSeriesSchema, await parseBody(request));

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

	const after = { ...before, ...patch };
	if (after.targetDate < after.startDate) throw error(400, 'The target date cannot be before the series starts.');
	if (after.hardLimitDate && after.hardLimitDate < after.targetDate)
		throw error(400, 'The hard limit cannot be before the target date.');

	// Turning enforcement on requires every windowed task to already sit in a window.
	if (patch.enforceWindows === 1 && !before.enforceWindows) {
		const [{ n }] = await db
			.select({ n: count() })
			.from(tasks)
			.innerJoin(books, eq(books.id, tasks.bookId))
			.innerJoin(stages, eq(stages.id, tasks.stageId))
			.where(and(
				eq(books.seriesId, before.id),
				eq(stages.ignoresWindows, 0),
				gt(tasks.durationDays, 0),
				eq(tasks.scheduleState, 'scheduled'),
				isNull(tasks.windowId)
			));
		if (n > 0) throw error(409, `${n} ${n === 1 ? 'task sits' : 'tasks sit'} outside any window. Place ${n === 1 ? 'it' : 'them'} in a window before enforcing.`);
	}

	const changed = Object.fromEntries(
		(Object.keys(patch) as (keyof SeriesRow)[]).filter((k) => patch[k] !== before[k]).map((k) => [k, patch[k]])
	);
	if (!Object.keys(changed).length) return json({ series: before });

	const updated = await db.transaction(async (tx) => {
		const [row] = await tx.update(series).set(changed).where(eq(series.id, before.id)).returning();
		await tx.insert(activityLog).values({
			id: ulid(), seriesId: before.id, actorId: personId,
			entity: 'series', entityId: before.id, action: 'update',
			beforeJson: JSON.stringify(Object.fromEntries(Object.keys(changed).map((k) => [k, before[k as keyof SeriesRow]]))),
			afterJson: JSON.stringify(changed),
			createdAt: new Date().toISOString(),
		});
		return row;
	});

	return json({ series: updated });
};
