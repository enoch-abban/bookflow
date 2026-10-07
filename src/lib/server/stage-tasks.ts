/**
 * Creating tasks for stages a book gains: lifting a skip, adding a stage, moving a book
 * to another track. New tasks are linked by the series' dependency pattern, placed after
 * their predecessors (never before today) under the window rules, and their successors
 * are pushed as usual. A direct link that the pattern now routes through a new task is
 * replaced; links the pattern does not explain (added by hand) are left alone.
 */
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { activityLog, dependencies, tasks, type stages } from '#lib/server/db/schema.ts';
import { bookLinks, type StageLink } from '../schedule/pattern.ts';
import { deriveEnd, toWorkingDay } from '../schedule/calendar.ts';
import { buildPredMap, earliestStart, propagate, settle, type Placement, type SchedTask } from './scheduler.ts';
import type { SeriesContext } from './series-context.ts';
import { writeTaskChanges, type Tx } from './schedule-write.ts';
import type { Log } from './removal.ts';

type StageRow = typeof stages.$inferSelect;
type Dep = typeof dependencies.$inferSelect;

export type NewTask = {
	id: string; bookId: string; stageId: string; windowId: string | null; scheduleState: 'scheduled' | 'unscheduled';
	title: string; startDate: string; endDate: string; durationDays: number; status: 'not_started';
};

export type PlacementPlan = {
	newTasks: NewTask[];
	links: Dep[];       // dependencies to add
	unlinked: Dep[];    // direct links now routed through a new task
	pushed: Map<string, Placement>;
};

/**
 * @param ctx      Series context; its task map is updated with the new and pushed tasks.
 * @param deps     The series' current dependency rows (with ids).
 * @param gains    For each book, the stages it gains.
 * @param pattern  The series' dependency pattern to link by.
 */
export function planNewTasks(opts: {
	ctx: SeriesContext;
	deps: Dep[];
	gains: { bookId: string; stages: StageRow[] }[];
	pattern: StageLink[];
	today: string;
}): PlacementPlan {
	const { ctx, pattern } = opts;
	const today = toWorkingDay(opts.today);
	const newTasks: NewTask[] = [];
	const links: Dep[] = [];
	const unlinked: Dep[] = [];

	for (const gain of opts.gains) {
		if (!gain.stages.length) continue;
		const existing = ctx.tasksData.filter((t) => t.bookId === gain.bookId && ctx.taskMap.has(t.id));
		const taskOfStage = new Map(existing.map((t) => [t.stageId, t.id]));
		const fresh = new Map(gain.stages.map((s) => [s.id, ulid()]));
		for (const [stageId, id] of fresh) taskOfStage.set(stageId, id);

		const wanted = bookLinks(new Set(taskOfStage.keys()), pattern);
		const freshIds = new Set(fresh.values());
		const touching = wanted.filter((l) => fresh.has(l.from) || fresh.has(l.to));
		for (const l of touching)
			links.push({ id: ulid(), predecessorId: taskOfStage.get(l.from)!, successorId: taskOfStage.get(l.to)!, lagDays: l.lagDays });

		// Existing direct links the pattern now routes through a new task.
		const wantedPairs = new Set(wanted.map((l) => `${taskOfStage.get(l.from)}>${taskOfStage.get(l.to)}`));
		const after = new Map<string, string[]>();
		for (const l of wanted) {
			const a = taskOfStage.get(l.from)!;
			after.set(a, [...(after.get(a) ?? []), taskOfStage.get(l.to)!]);
		}
		const reaches = (from: string, to: string) => {
			const queue = [from];
			const seen = new Set<string>();
			while (queue.length) {
				const cur = queue.shift()!;
				if (cur === to) return true;
				if (seen.has(cur)) continue;
				seen.add(cur);
				queue.push(...(after.get(cur) ?? []));
			}
			return false;
		};
		const ownIds = new Set(existing.map((t) => t.id));
		for (const d of opts.deps) {
			if (!ownIds.has(d.predecessorId) || !ownIds.has(d.successorId)) continue;
			if (wantedPairs.has(`${d.predecessorId}>${d.successorId}`)) continue;
			if ([...freshIds].some((n) => reaches(d.predecessorId, n) && reaches(n, d.successorId))) unlinked.push(d);
		}

		// Place the new tasks in dependency order, after their predecessors, never before today.
		const current = [
			...opts.deps.filter((d) => !unlinked.includes(d)),
			...links,
		];
		const { predMap } = buildPredMap(current);
		const pending = [...gain.stages];
		while (pending.length) {
			const i = Math.max(0, pending.findIndex((s) =>
				!touching.some((l) => l.to === s.id && fresh.has(l.from) && pending.some((p) => p.id === l.from))));
			const stage = pending.splice(i, 1)[0];
			const id = fresh.get(stage.id)!;
			const draft: SchedTask = {
				id, startDate: today, endDate: deriveEnd(today, stage.defaultDays), durationDays: stage.defaultDays,
				status: 'not_started', windowId: null, scheduleState: 'scheduled', ignoresWindows: !!stage.ignoresWindows, version: 1,
			};
			ctx.taskMap.set(id, draft);
			const earliest = earliestStart(id, ctx.taskMap, predMap);
			const placed = settle(draft, earliest && earliest > today ? earliest : today, ctx.rules);
			ctx.taskMap.set(id, { ...draft, ...placed });
			newTasks.push({
				id, bookId: gain.bookId, stageId: stage.id, windowId: placed.windowId ?? null,
				scheduleState: placed.scheduleState ?? 'scheduled', title: stage.name,
				startDate: placed.startDate, endDate: placed.endDate, durationDays: stage.defaultDays, status: 'not_started',
			});
		}
	}

	const allDeps = [...opts.deps.filter((d) => !unlinked.includes(d)), ...links];
	const pushed = propagate(new Set(newTasks.map((t) => t.id)), ctx.taskMap, allDeps, ctx.rules);
	for (const t of newTasks) pushed.delete(t.id);
	return { newTasks, links, unlinked, pushed };
}

/** Save a plan: new tasks, relinked dependencies and pushed successors, all logged for undo. */
export async function writePlan(tx: Tx, plan: PlacementPlan, opts: {
	seriesId: string; actorId: string; batchId: string; now: string; log: Log; original: Map<string, SchedTask>;
}) {
	const { log, now } = opts;
	for (const t of plan.newTasks) {
		const row = { ...t, createdAt: now, updatedAt: now };
		await tx.insert(tasks).values(row);
		await tx.insert(activityLog).values(log('task', t.id, 'create', null, row));
	}
	for (const d of plan.unlinked) {
		await tx.delete(dependencies).where(eq(dependencies.id, d.id));
		await tx.insert(activityLog).values(log('dependency', d.id, 'delete', d, null));
	}
	for (const d of plan.links) {
		await tx.insert(dependencies).values(d);
		await tx.insert(activityLog).values(log('dependency', d.id, 'create', null, d));
	}
	await writeTaskChanges(tx, {
		seriesId: opts.seriesId, actorId: opts.actorId, batchId: opts.batchId, now, original: opts.original,
		changes: [...plan.pushed].map(([id, p]) => ({ id, ...p, windowId: p.windowId ?? null, action: p.scheduleState === 'unscheduled' ? 'unschedule' : 'move' })),
	});
}

/** The plan as shown in previews. */
export function describePlan(ctx: SeriesContext, plan: PlacementPlan, original: Map<string, SchedTask>, stageName: Map<string, string>, bookCode: Map<string, string>) {
	const winLabel = new Map(ctx.windows.map((w) => [w.id, w.label]));
	return {
		tasks: plan.newTasks.map((t) => ({
			book: bookCode.get(t.bookId) ?? '', stage: stageName.get(t.stageId) ?? '', startDate: t.startDate, endDate: t.endDate,
			window: t.windowId ? winLabel.get(t.windowId) ?? null : null, scheduleState: t.scheduleState,
		})),
		linked: plan.links.length,
		unlinked: plan.unlinked.length,
		pushed: [...plan.pushed].map(([id, p]) => ({ label: ctx.labels.get(id) ?? id, from: original.get(id)?.startDate ?? '', to: p.startDate, scheduleState: p.scheduleState })),
	};
}
