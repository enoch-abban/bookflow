// Refit: re-place tasks after a change to windows or window rules (spec: Changing windows).
// Pure; the caller loads the series state and saves the result as one batch.

import {
	buildPredMap, earliestStart, fitsWindowFor, isFrozen, isWindowed, settle,
	type Placement, type SchedDep, type SchedTask, type WindowRules
} from './scheduler.ts';
import { windowAt } from '../schedule/windows.ts';

export type RefitKind = 'moved' | 'unscheduled' | 'placed' | 'window';

export type RefitChange = { id: string; kind: RefitKind; before: Placement; after: Placement };

export type RefitResult = {
	changes: RefitChange[];
	/** Started tasks that no longer fit their window; they are flagged, never moved. */
	outsideWindow: string[];
};

/** Tasks ordered so predecessors come before successors; ties by start date. */
export function topoOrder(taskMap: Map<string, SchedTask>, deps: SchedDep[]): SchedTask[] {
	const { succMap } = buildPredMap(deps);
	const indeg = new Map<string, number>([...taskMap.keys()].map((id) => [id, 0]));
	for (const d of deps) if (taskMap.has(d.successorId) && taskMap.has(d.predecessorId))
		indeg.set(d.successorId, (indeg.get(d.successorId) ?? 0) + 1);

	const byStart = (a: string, b: string) => taskMap.get(a)!.startDate.localeCompare(taskMap.get(b)!.startDate) || a.localeCompare(b);
	const ready = [...indeg].filter(([, n]) => n === 0).map(([id]) => id).sort(byStart);
	const out: SchedTask[] = [];
	const seen = new Set<string>();
	while (ready.length) {
		const id = ready.shift()!;
		seen.add(id);
		out.push(taskMap.get(id)!);
		for (const s of succMap.get(id) ?? []) {
			if (!indeg.has(s)) continue;
			indeg.set(s, indeg.get(s)! - 1);
			if (indeg.get(s) === 0) { ready.push(s); ready.sort(byStart); }
		}
	}
	// Dependencies are acyclic, but never drop a task if that ever breaks.
	for (const t of taskMap.values()) if (!seen.has(t.id)) out.push(t);
	return out;
}

const kindOf = (before: Placement, after: Placement): RefitKind => {
	if (after.scheduleState === 'unscheduled') return 'unscheduled';
	if (before.scheduleState === 'unscheduled') return 'placed';
	if (before.startDate !== after.startDate || before.endDate !== after.endDate) return 'moved';
	return 'window';
};

const placementOf = (t: SchedTask): Placement => ({
	startDate: t.startDate, endDate: t.endDate, windowId: t.windowId, scheduleState: t.scheduleState ?? 'scheduled'
});

/**
 * Re-place every task under `rules`:
 * - not-started tasks stay in the window they start in while they fit, otherwise move
 *   forward to the earliest later window with room, otherwise become unscheduled;
 * - unscheduled tasks are retried from the earliest date their predecessors allow;
 * - successors of anything that moved are pushed by the normal propagation rule;
 * - started and done tasks keep their dates; they take the window they start in, and
 *   started ones that no longer fit are reported as Outside window.
 *
 * @param taskMap Mutable; updated in place with the new placements.
 */
export function refit(taskMap: Map<string, SchedTask>, deps: SchedDep[], rules: WindowRules, opts: { rederive?: boolean } = {}): RefitResult {
	const { predMap } = buildPredMap(deps);
	const changes: RefitChange[] = [];
	const changed = new Set<string>();
	const outsideWindow: string[] = [];

	for (const t of topoOrder(taskMap, deps)) {
		const before = placementOf(t);
		let after: Placement;

		if (isFrozen(t)) {
			const w = isWindowed(t, rules) ? windowAt(t.startDate, rules.windows) : null;
			after = { ...before, windowId: w?.id ?? null, scheduleState: 'scheduled' };
			if (t.status !== 'done' && isWindowed(t, rules) && !(w && fitsWindowFor(t, w, rules))) outsideWindow.push(t.id);
		} else {
			const predMoved = (predMap.get(t.id) ?? []).some((p) => changed.has(p.id));
			const minStart = predMoved || t.scheduleState === 'unscheduled'
				? (earliestStart(t.id, taskMap, predMap) ?? t.startDate)
				: t.startDate;
			after = settle(t, minStart, rules, opts);
		}

		if (before.startDate === after.startDate && before.endDate === after.endDate &&
			before.windowId === after.windowId && before.scheduleState === after.scheduleState) continue;

		taskMap.set(t.id, { ...t, ...after });
		changed.add(t.id);
		changes.push({ id: t.id, kind: kindOf(before, after), before, after });
	}

	return { changes, outsideWindow };
}
