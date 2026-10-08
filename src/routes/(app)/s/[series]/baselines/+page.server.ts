import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { and, asc, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { baselines, baselineTasks, books, series, stages, tasks } from '#lib/server/db/schema.ts';
import { requireCoord } from '#lib/server/api-auth.ts';
import { refreshHolidays } from '#lib/server/calendar-db.ts';
import { workingDaysBetween } from '#lib/schedule/calendar.ts';
import { baselineDates, nextBaselineName } from '#lib/server/baselines.ts';

// Baselines (spec: Baselines): the saved baselines, and the current plan's variance against
// one of them (the latest unless ?b= picks another). Variance is planned end minus baseline
// end in working days, so a positive number is slippage.
export const load: PageServerLoad = async ({ params, url, locals }) => {
	await requireCoord(locals, params.series);
	await refreshHolidays();
	const ser = await db.select().from(series).where(eq(series.id, params.series)).then((r) => r[0]);
	if (!ser) throw error(404, 'Series not found');

	const list = await db.select({ id: baselines.id, name: baselines.name, createdAt: baselines.createdAt, taskCount: count(baselineTasks.taskId) })
		.from(baselines).leftJoin(baselineTasks, eq(baselineTasks.baselineId, baselines.id))
		.where(eq(baselines.seriesId, ser.id)).groupBy(baselines.id).orderBy(desc(baselines.createdAt));
	const selected = list.find((b) => b.id === url.searchParams.get('b')) ?? list[0] ?? null;

	const [stageRows, bookRows] = await Promise.all([
		db.select().from(stages).where(and(eq(stages.seriesId, ser.id), isNull(stages.archivedAt))).orderBy(asc(stages.sortOrder)),
		db.select().from(books).where(and(eq(books.seriesId, ser.id), isNull(books.archivedAt))).orderBy(asc(books.sortOrder)),
	]);
	const taskRows = bookRows.length && stageRows.length
		? await db.select().from(tasks).where(and(inArray(tasks.bookId, bookRows.map((b) => b.id)), inArray(tasks.stageId, stageRows.map((s) => s.id))))
		: [];
	const base = selected ? await baselineDates(selected.id, taskRows.map((t) => t.id)) : new Map();

	const stageOrder = new Map(stageRows.map((s, i) => [s.id, i]));
	const stageById = new Map(stageRows.map((s) => [s.id, s]));
	const bookOrder = new Map(bookRows.map((b, i) => [b.id, i]));
	const bookById = new Map(bookRows.map((b) => [b.id, b]));

	const rows = taskRows
		.sort((a, b) => bookOrder.get(a.bookId)! - bookOrder.get(b.bookId)! || stageOrder.get(a.stageId)! - stageOrder.get(b.stageId)!)
		.map((t) => {
			const b = base.get(t.id);
			const placed = t.scheduleState === 'scheduled';
			return {
				id: t.id, book: bookById.get(t.bookId)!.code, stage: stageById.get(t.stageId)!.name, status: t.status,
				startDate: t.startDate, endDate: t.endDate, unscheduled: !placed,
				baseStart: b?.startDate ?? null, baseEnd: b?.endDate ?? null,
				variance: b && placed ? workingDaysBetween(b.endDate, t.endDate) : null,
			};
		});

	// Per book: projected finish (binding end) against the baseline's.
	const bindingStage = stageRows.find((s) => s.key === 'binding');
	const bookSummary = bookRows.map((bk) => {
		const t = bindingStage ? taskRows.find((x) => x.bookId === bk.id && x.stageId === bindingStage.id) : undefined;
		const b = t ? base.get(t.id) : undefined;
		const tasksOf = rows.filter((r) => r.book === bk.code);
		return {
			code: bk.code, name: bk.name,
			finish: t && t.scheduleState === 'scheduled' ? t.endDate : null, baseFinish: b?.endDate ?? null,
			variance: t && b && t.scheduleState === 'scheduled' ? workingDaysBetween(b.endDate, t.endDate) : null,
			late: tasksOf.filter((r) => (r.variance ?? 0) > 0).length,
		};
	});

	const compared = rows.filter((r) => r.variance !== null);
	const finishes = bookSummary.filter((b) => b.finish).map((b) => b.finish!);
	const baseFinishes = bookSummary.filter((b) => b.baseFinish).map((b) => b.baseFinish!);
	const projected = finishes.length ? finishes.reduce((a, b) => (b > a ? b : a)) : null;
	const baseProjected = baseFinishes.length ? baseFinishes.reduce((a, b) => (b > a ? b : a)) : null;

	return {
		series: { id: ser.id, name: ser.name, targetDate: ser.targetDate, hardLimitDate: ser.hardLimitDate },
		baselines: list,
		selected,
		suggestedName: nextBaselineName(list.map((b) => b.name)),
		rows,
		books: bookSummary,
		summary: {
			later: compared.filter((r) => r.variance! > 0).length,
			earlier: compared.filter((r) => r.variance! < 0).length,
			same: compared.filter((r) => r.variance === 0).length,
			added: rows.filter((r) => !r.baseEnd).length,
			worst: compared.reduce((m, r) => Math.max(m, r.variance!), 0),
			projected, baseProjected,
			finishVariance: projected && baseProjected ? workingDaysBetween(baseProjected, projected) : null,
		},
	};
};
