/**
 * Adding and removing holidays (spec: Calendar). Holidays are global, so a change
 * refits every series: not-started tasks keep their duration in working days and are
 * laid out again around the new calendar, successors are pushed and window rules
 * applied. Started and Done tasks never move. Previewed, then one undoable batch.
 */
import { error } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { db } from '#lib/server/db/index.ts';
import { activityLog, holidays, series } from '#lib/server/db/schema.ts';
import { withHolidays } from '../schedule/calendar.ts';
import { forgetHolidays, refreshHolidays } from './calendar-db.ts';
import { loadSeriesContext } from './series-context.ts';
import { refit, type RefitResult } from './refit.ts';
import type { SchedTask } from './scheduler.ts';
import { refitChanges, refitReport, writeTaskChanges } from './schedule-write.ts';

export type HolidayOp = { kind: 'add'; date: string; label: string } | { kind: 'remove'; date: string };

export async function changeHoliday(opts: { op: HolidayOp; actorId: string; preview: boolean }) {
	const { op } = opts;
	const current = await refreshHolidays({ fresh: true });
	const existing = current.find((h) => h.date === op.date);
	if (op.kind === 'add' && existing) throw error(409, `${op.date} is already a holiday (${existing.label}).`);
	if (op.kind === 'remove' && !existing) throw error(404, `${op.date} is not a holiday.`);

	const next = op.kind === 'add' ? [...current.map((h) => h.date), op.date] : current.map((h) => h.date).filter((d) => d !== op.date);

	// Refit each series under the new calendar. The temporary holiday set is applied only
	// inside the synchronous refit, so concurrent requests never see it.
	const allSeries = await db.select().from(series).orderBy(asc(series.name));
	type Plan = {
		ser: typeof series.$inferSelect;
		original: Map<string, SchedTask>;
		result: RefitResult;
		report: ReturnType<typeof refitReport>;
	};
	const plans: Plan[] = [];
	for (const ser of allSeries) {
		const ctx = await loadSeriesContext(ser.id);
		const original = new Map([...ctx.taskMap].map(([k, v]) => [k, { ...v }]));
		const result = withHolidays(next, () => refit(ctx.taskMap, ctx.depList, ctx.rules, { rederive: true }));
		plans.push({ ser, original, result, report: refitReport(ctx, original, result) });
	}

	const holiday = op.kind === 'add' ? { date: op.date, label: op.label } : existing!;
	const summary = {
		holiday,
		weekend: [0, 6].includes(new Date(op.date + 'T12:00:00Z').getUTCDay()),
		series: plans.map((p) => ({ id: p.ser.id, name: p.ser.name, report: p.report })),
	};
	if (opts.preview) return { preview: true as const, ...summary };

	const batchId = ulid();
	const now = new Date().toISOString();
	await db.transaction(async (tx) => {
		if (op.kind === 'add') await tx.insert(holidays).values(holiday);
		else await tx.delete(holidays).where(eq(holidays.date, op.date));
		await tx.insert(activityLog).values({
			id: ulid(), seriesId: null, actorId: opts.actorId, entity: 'holiday', entityId: op.date, action: op.kind === 'add' ? 'create' : 'delete',
			beforeJson: op.kind === 'remove' ? JSON.stringify(holiday) : null,
			afterJson: op.kind === 'add' ? JSON.stringify(holiday) : null,
			batchId, createdAt: now,
		});
		for (const p of plans)
			if (p.result.changes.length)
				await writeTaskChanges(tx, { seriesId: p.ser.id, actorId: opts.actorId, batchId, now, original: p.original, changes: refitChanges(p.result) });
	});
	forgetHolidays();
	await refreshHolidays({ fresh: true });
	return { preview: false as const, ...summary, batchId };
}
