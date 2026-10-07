import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	baselines, baselineTasks, bookStageSkips, books, dependencies, people, printApprovals, printRecords, reviewCycles, series,
	stageTracks, stages, taskAssignees, taskComments, tasks, tracks, windows
} from '#lib/server/db/schema.ts';
import { requireMember } from '#lib/server/api-auth.ts';
import { workingDaysBetween } from '#lib/schedule/calendar.ts';
import { recordAccess } from '#lib/server/print-records.ts';
import { refreshHolidays } from '#lib/server/calendar-db.ts';
import { criticalPath } from '#lib/schedule/critical.ts';

// Book detail (spec: Book detail): ISBN and edition, the pipeline as a stepper, every task
// with dates and variance from the latest baseline, review history, comments, and the
// print approval and print records. Archived books stay viewable here.
export const load: PageServerLoad = async ({ params, locals }) => {
	const me = await requireMember(locals, params.series);
	await refreshHolidays();
	const ser = await db.select().from(series).where(eq(series.id, params.series)).then((r) => r[0]);
	if (!ser) throw error(404, 'Series not found');
	const book = await db.select().from(books)
		.where(and(eq(books.seriesId, ser.id), eq(books.code, params.code))).then((r) => r[0]);
	if (!book) throw error(404, `No book ${params.code} in ${ser.name}`);

	const [track, trackStageRows, skips, taskRows, windowRows, approval, record] = await Promise.all([
		db.select().from(tracks).where(eq(tracks.id, book.trackId)).then((r) => r[0] ?? null),
		db.select({ s: stages }).from(stageTracks).innerJoin(stages, eq(stages.id, stageTracks.stageId))
			.where(eq(stageTracks.trackId, book.trackId)).orderBy(asc(stages.sortOrder)).then((r) => r.map((x) => x.s)),
		db.select().from(bookStageSkips).where(eq(bookStageSkips.bookId, book.id)),
		db.select({ t: tasks, stage: stages }).from(tasks).innerJoin(stages, eq(stages.id, tasks.stageId))
			.where(eq(tasks.bookId, book.id)).orderBy(asc(stages.sortOrder)),
		db.select().from(windows).where(eq(windows.seriesId, ser.id)),
		db.select({ a: printApprovals, by: people.displayName }).from(printApprovals)
			.innerJoin(people, eq(people.id, printApprovals.approvedBy)).where(eq(printApprovals.bookId, book.id)).then((r) => r[0] ?? null),
		db.select().from(printRecords).where(eq(printRecords.bookId, book.id)).then((r) => r[0] ?? null),
	]);
	const taskIds = taskRows.map((r) => r.t.id);

	// Variance against the latest baseline (Rev 5 on import).
	const baseline = await db.select().from(baselines).where(eq(baselines.seriesId, ser.id)).orderBy(desc(baselines.createdAt)).limit(1).then((r) => r[0] ?? null);
	const [baseRows, assignees, reviews, comments] = taskIds.length
		? await Promise.all([
			baseline ? db.select().from(baselineTasks).where(and(eq(baselineTasks.baselineId, baseline.id), inArray(baselineTasks.taskId, taskIds))) : [],
			db.select({ a: taskAssignees, name: people.displayName }).from(taskAssignees).innerJoin(people, eq(people.id, taskAssignees.personId))
				.where(inArray(taskAssignees.taskId, taskIds)),
			db.select({ r: reviewCycles, name: people.displayName }).from(reviewCycles).innerJoin(people, eq(people.id, reviewCycles.reviewerId))
				.where(inArray(reviewCycles.taskId, taskIds)).orderBy(desc(reviewCycles.createdAt)),
			db.select({ c: taskComments, name: people.displayName }).from(taskComments).innerJoin(people, eq(people.id, taskComments.authorId))
				.where(inArray(taskComments.taskId, taskIds)).orderBy(desc(taskComments.createdAt)),
		])
		: [[], [], [], []];

	const winLabel = new Map(windowRows.map((w) => [w.id, w.label]));
	const stageOf = new Map(taskRows.map((r) => [r.t.id, r.stage]));
	const taskList = taskRows.map(({ t, stage }) => {
		const base = baseRows.find((b) => b.taskId === t.id) ?? null;
		const people_ = assignees.filter((a) => a.a.taskId === t.id);
		return {
			id: t.id, stage: stage.name, stageKey: stage.key, category: stage.category, isReview: !!stage.isReview,
			stageArchived: !!stage.archivedAt, status: t.status, iteration: t.iteration,
			startDate: t.startDate, endDate: t.endDate, durationDays: t.durationDays, dueDate: t.dueDate,
			scheduleState: t.scheduleState, window: t.windowId ? winLabel.get(t.windowId) ?? null : null,
			feedbackUrl: t.feedbackUrl,
			lead: people_.find((a) => a.a.isLead)?.name ?? people_[0]?.name ?? null,
			others: people_.filter((a) => !a.a.isLead).map((a) => a.name),
			baselineEnd: base?.endDate ?? null,
			variance: base ? workingDaysBetween(base.endDate, t.endDate) : null,
			reviewsDone: reviews.filter((r) => r.r.taskId === t.id).length,
			reviewPending: t.status === 'in_review',
		};
	});

	// The track's stages in order, each with this book's state; archived stages appear only where they hold history.
	const skipped = new Set(skips.map((k) => k.stageId));
	const stepper = trackStageRows
		.filter((s) => !s.archivedAt || taskRows.some((r) => r.stage.id === s.id))
		.map((s) => {
			const t = taskRows.find((r) => r.stage.id === s.id)?.t;
			return { id: s.id, name: s.name, category: s.category, state: skipped.has(s.id) ? 'skipped' : t ? t.status : 'missing' };
		});

	const binding = taskList.find((t) => t.stageKey === 'binding');

	// This book's critical path: tasks that cannot slip without delaying its binding. Other
	// books' tasks count too, since a cross-book link can hold this book up.
	let criticalIds: string[] = [];
	if (binding) {
		const seriesTasks = await db.select({ id: tasks.id, startDate: tasks.startDate, endDate: tasks.endDate, durationDays: tasks.durationDays, status: tasks.status })
			.from(tasks).innerJoin(books, eq(books.id, tasks.bookId)).where(eq(books.seriesId, ser.id));
		const seriesDeps = await db.select({ predecessorId: dependencies.predecessorId, successorId: dependencies.successorId, lagDays: dependencies.lagDays })
			.from(dependencies).innerJoin(tasks, eq(tasks.id, dependencies.successorId)).innerJoin(books, eq(books.id, tasks.bookId))
			.where(eq(books.seriesId, ser.id));
		const onPath = criticalPath(seriesTasks, seriesDeps, [binding.id]);
		criticalIds = taskList.filter((t) => onPath.has(t.id)).map((t) => t.id);
	}
	const deposit = taskList.find((t) => t.stageKey === 'legal_deposit');
	const isCoord = me.isAdmin || me.role === 'coordinator';
	const access = await recordAccess(locals, book);

	return {
		series: { id: ser.id, name: ser.name, bookGroupLabel: ser.bookGroupLabel, targetDate: ser.targetDate, hardLimitDate: ser.hardLimitDate },
		book: { ...book, trackName: track?.name ?? '' },
		baseline: baseline ? { name: baseline.name } : null,
		stepper,
		tasks: taskList,
		projectedFinish: binding?.endDate ?? null,
		depositDue: deposit?.dueDate ?? null,
		approval: approval ? { by: approval.by, at: approval.a.approvedAt, note: approval.a.note } : null,
		printRecord: record,
		reviews: reviews.map((r) => ({
			id: r.r.id, stage: stageOf.get(r.r.taskId)?.name ?? '', iteration: r.r.iteration, reviewer: r.name,
			outcome: r.r.outcome, comments: r.r.comments, at: r.r.createdAt,
		})),
		comments: comments.map((c) => ({ id: c.c.id, stage: stageOf.get(c.c.taskId)?.name ?? '', author: c.name, body: c.c.body, at: c.c.createdAt })),
		criticalIds,
		canEdit: isCoord,
		canEditRecord: access.production && !book.archivedAt,
	};
};
