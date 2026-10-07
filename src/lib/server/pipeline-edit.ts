/**
 * Pipeline edits that never create or delete tasks (spec: Pipeline changes, Edits).
 * A stage edit that changes "ignores windows" refits the schedule, and one that changes
 * the deadline rule recomputes due dates; both are previewed, then saved as one batch.
 */
import { error } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import { ulid } from 'ulid';
import { db } from '#lib/server/db/index.ts';
import { activityLog, books, stages, tasks, tracks } from '#lib/server/db/schema.ts';
import { dueDateChanges } from '../schedule/deadlines.ts';
import { loadSeriesContext } from './series-context.ts';
import { refit, type RefitResult } from './refit.ts';
import { refitChanges, refitReport, writeTaskChanges } from './schedule-write.ts';
import type { DeadlineRule } from '../schedule/deadlines.ts';

type StageRow = typeof stages.$inferSelect;

export type StageEdit = Partial<{
	name: string;
	category: StageRow['category'];
	defaultDays: number;
	isReview: boolean;
	isExternal: boolean;
	ignoresWindows: boolean;
	deadlineRule: DeadlineRule | null;
}>;

const IN_REVIEW = ['in_review', 'returned'];

export async function loadStage(id: string): Promise<StageRow> {
	const row = await db.select().from(stages).where(eq(stages.id, id)).then((r) => r[0]);
	if (!row) throw error(404, 'Stage not found');
	return row;
}

export async function editStage(opts: { stage: StageRow; edit: StageEdit; actorId: string; preview: boolean }) {
	const { stage: before, edit, actorId } = opts;
	const seriesId = before.seriesId;

	const patch: Partial<StageRow> = {};
	if (edit.name !== undefined) patch.name = edit.name;
	if (edit.category !== undefined) patch.category = edit.category;
	if (edit.defaultDays !== undefined) patch.defaultDays = edit.defaultDays;
	if (edit.isReview !== undefined) patch.isReview = edit.isReview ? 1 : 0;
	if (edit.isExternal !== undefined) patch.isExternal = edit.isExternal ? 1 : 0;
	if (edit.ignoresWindows !== undefined) patch.ignoresWindows = edit.ignoresWindows ? 1 : 0;
	if (edit.deadlineRule !== undefined) patch.deadlineRule = edit.deadlineRule ? JSON.stringify(edit.deadlineRule) : null;

	const after = { ...before, ...patch };
	const changed = Object.fromEntries(
		(Object.keys(patch) as (keyof StageRow)[]).filter((k) => patch[k] !== before[k]).map((k) => [k, patch[k]])
	) as Partial<StageRow>;

	const stageTasks = await db.select().from(tasks).where(eq(tasks.stageId, before.id));

	// Gates have no duration: switching to or from Gate would invalidate every existing task.
	if ('category' in changed && (before.category === 'gate') !== (after.category === 'gate') && stageTasks.length)
		throw error(409, `This stage has ${stageTasks.length} tasks, so it cannot become ${after.category === 'gate' ? 'a gate' : 'a working stage'}.`);
	if (after.category === 'gate' && after.defaultDays !== 0) throw error(400, 'A gate has no duration: set its default days to 0.');
	if (after.category !== 'gate' && after.defaultDays < 1) throw error(400, 'A working stage needs at least 1 default day.');

	// Turning the review flag off would strand tasks in a review status.
	if (changed.isReview === 0) {
		const stuck = stageTasks.filter((t) => IN_REVIEW.includes(t.status) || (t.status === 'blocked' && IN_REVIEW.includes(t.statusBeforeBlock ?? '')));
		if (stuck.length)
			throw error(409, `${stuck.length} of this stage's tasks ${stuck.length === 1 ? 'is' : 'are'} In review or Returned. Finish those reviews first.`);
	}

	if (edit.deadlineRule) {
		const base = await db.select({ id: stages.id }).from(stages)
			.where(and(eq(stages.seriesId, seriesId), eq(stages.key, edit.deadlineRule.after))).then((r) => r[0]);
		if (!base || base.id === before.id) throw error(400, 'The deadline must count from another stage in this series.');
	}

	// Window exemption changed: refit under the new flag.
	const ctx = 'ignoresWindows' in changed || 'deadlineRule' in changed ? await loadSeriesContext(seriesId) : null;
	const original = ctx ? new Map([...ctx.taskMap].map(([k, v]) => [k, { ...v }])) : null;
	let result: RefitResult | null = null;
	if (ctx && 'ignoresWindows' in changed) {
		for (const t of stageTasks) {
			const cur = ctx.taskMap.get(t.id);
			if (cur) ctx.taskMap.set(t.id, { ...cur, ignoresWindows: !!after.ignoresWindows });
		}
		result = refit(ctx.taskMap, ctx.depList, ctx.rules);
	}
	const report = ctx && result ? refitReport(ctx, original!, result) : null;

	// Deadline rule changed: due dates follow, computed on the (possibly refitted) end dates.
	let dueDates: { id: string; label: string; from: string | null; to: string | null }[] = [];
	if (ctx && 'deadlineRule' in changed) {
		const allStages = await db.select({ id: stages.id, key: stages.key, deadlineRule: stages.deadlineRule })
			.from(stages).where(eq(stages.seriesId, seriesId));
		const rules = allStages.map((s) => (s.id === before.id ? { ...s, deadlineRule: after.deadlineRule } : s));
		const current = ctx.tasksData.map((t) => ({ ...t, endDate: ctx.taskMap.get(t.id)?.endDate ?? t.endDate }));
		dueDates = dueDateChanges(current, rules).map((c) => ({ ...c, label: ctx.labels.get(c.id) ?? c.id }));
	}

	const stageOut = { ...after, deadlineRule: after.deadlineRule };
	if (opts.preview) return { preview: true as const, stage: stageOut, report, dueDates };
	if (!Object.keys(changed).length) return { preview: false as const, stage: before, report: null, dueDates: [] };

	const batchId = ulid();
	const now = new Date().toISOString();
	await db.transaction(async (tx) => {
		await tx.update(stages).set(changed).where(eq(stages.id, before.id));
		await tx.insert(activityLog).values({
			id: ulid(), seriesId, actorId, entity: 'stage', entityId: before.id, action: 'update',
			beforeJson: JSON.stringify(Object.fromEntries(Object.keys(changed).map((k) => [k, before[k as keyof StageRow]]))),
			afterJson: JSON.stringify(changed), batchId, createdAt: now,
		});

		const versions = new Map(ctx ? [...original!].map(([id, t]) => [id, t.version]) : []);
		if (result?.changes.length) {
			const written = await writeTaskChanges(tx, { seriesId, actorId, batchId, now, original: original!, changes: refitChanges(result) });
			for (const w of written) versions.set(w.id, w.version);
		}
		for (const d of dueDates) {
			const version = versions.get(d.id)!;
			await tx.update(tasks).set({ dueDate: d.to, version: version + 1, updatedAt: now }).where(eq(tasks.id, d.id));
			await tx.insert(activityLog).values({
				id: ulid(), seriesId, actorId, entity: 'task', entityId: d.id, action: 'deadline',
				beforeJson: JSON.stringify({ dueDate: d.from, version }), afterJson: JSON.stringify({ dueDate: d.to, version: version + 1 }),
				batchId, createdAt: now,
			});
		}
	});

	return { preview: false as const, stage: await loadStage(before.id), report, dueDates, batchId };
}

const ORDERED = { track: tracks, stage: stages, book: books } as const;

/** Set the display order of a series' tracks, stages (matrix columns) or books. Dependencies are untouched. */
export async function reorder(kind: keyof typeof ORDERED, seriesId: string, ids: string[], actorId: string) {
	const table = ORDERED[kind];
	const rows = await db.select({ id: table.id }).from(table).where(eq(table.seriesId, seriesId));
	const known = new Set(rows.map((r) => r.id));
	if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id)))
		throw error(400, `Send every ${kind} in this series exactly once.`);

	await db.transaction(async (tx) => {
		for (const [i, id] of ids.entries()) await tx.update(table).set({ sortOrder: i + 1 }).where(eq(table.id, id));
		await tx.insert(activityLog).values({
			id: ulid(), seriesId, actorId, entity: kind, entityId: seriesId, action: 'reorder',
			afterJson: JSON.stringify(ids), createdAt: new Date().toISOString(),
		});
	});
	return db.select().from(table).where(inArray(table.id, ids));
}
