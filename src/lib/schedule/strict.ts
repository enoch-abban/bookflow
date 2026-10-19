// Strict mode (spec: Swimlane editor). One check on the planned result of a change: is any
// task left starting before its predecessors allow? Uses the same earliest-start rule as
// propagation, gates and lags included. Pure, shared by the server and the swimlane drag.

import { workingDaysBetween } from './calendar.ts';
import { buildPredMap, earliestStart, isFrozen, propagate, type SchedDep, type SchedTask, type WindowRules } from './scheduler.ts';

export type Conflict = {
	taskId: string;
	/** The earliest start its predecessors allow. */
	earliest: string;
	/** Working days it starts too early. */
	days: number;
	/** The predecessors that start it too early. */
	predecessorIds: string[];
	/** Started or Done: it will not move, so a push stopped here. */
	frozen: boolean;
};

export type Plan = { taskMap: Map<string, SchedTask>; deps: SchedDep[] };

/** Every task that starts before its predecessors allow. */
export function conflictsOf({ taskMap, deps }: Plan): Map<string, Conflict> {
	const { predMap } = buildPredMap(deps);
	const out = new Map<string, Conflict>();
	for (const [id, t] of taskMap) {
		const preds = predMap.get(id);
		if (!preds?.length) continue;
		const earliest = earliestStart(id, taskMap, predMap);
		if (!earliest || t.startDate >= earliest) continue;
		// Which predecessors push it past its start: each one's own earliest, as earliestStart counts it.
		const predecessorIds = preds
			.filter((p) => {
				const one = earliestStart(id, taskMap, new Map([[id, [p]]]));
				return !!one && t.startDate < one;
			})
			.map((p) => p.id);
		out.set(id, { taskId: id, earliest, days: workingDaysBetween(t.startDate, earliest), predecessorIds, frozen: isFrozen(t) });
	}
	return out;
}

/**
 * The conflicts a change would cause: new ones, and existing ones made worse (more working
 * days too early). Tasks in `always`, the ones the change moves on purpose, may not end in
 * conflict at all. Conflicts the change leaves as they were are not its doing, so they pass.
 */
export function strictConflicts(before: Plan, after: Plan, always: Iterable<string> = []): Conflict[] {
	const was = conflictsOf(before);
	const must = new Set(always);
	return [...conflictsOf(after).values()].filter((c) => must.has(c.taskId) || !was.has(c.taskId) || c.days > was.get(c.taskId)!.days);
}

/**
 * The conflicts moving one task would cause: move it on a copy of `base`, push its
 * successors as the server does, and check. Used by the swimlane while a bar is dragged.
 */
export function tryMove(base: Plan, taskId: string, move: { startDate: string; endDate: string; durationDays: number }, rules: WindowRules): Conflict[] {
	const after = new Map([...base.taskMap].map(([k, v]) => [k, { ...v }]));
	after.set(taskId, { ...after.get(taskId)!, ...move });
	propagate(new Set([taskId]), after, base.deps, rules);
	return strictConflicts(base, { taskMap: after, deps: base.deps }, [taskId]);
}
