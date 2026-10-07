// Working-day scheduler. Holidays table is populated by admins; for now we
// ship with an empty table and use Mon-Fri as working days.

import { addWorkingDays, deriveEnd, nextWorkingDay, toWorkingDay } from '../schedule/calendar.ts';
import { fitsWindow, placeInWindows, windowAt, type Win } from '../schedule/windows.ts';

export { addWorkingDays, deriveEnd, isWorkingDay, nextWorkingDay, toWorkingDay } from '../schedule/calendar.ts';

export type SchedTask = {
	id: string;
	startDate: string;
	endDate: string;
	durationDays: number;
	status: string;
	statusBeforeBlock?: string | null;
	windowId: string | null;
	scheduleState?: 'scheduled' | 'unscheduled';
	overflowAllowed?: boolean;
	/** Publishing stages run on the agency's clock and never sit in a window. */
	ignoresWindows?: boolean;
	version: number;
};

export type SchedDep = {
	predecessorId: string;
	successorId: string;
	lagDays: number;
};

/** Window rules for a series. With `enforce` off, windows are reference bands only. */
export type WindowRules = {
	enforce: boolean;
	windows: Win[];
	overflowDays: number;
};

export const NO_WINDOWS: WindowRules = { enforce: false, windows: [], overflowDays: 0 };

const later = (a: string, b: string) => (a > b ? a : b);

// ── Task classification ─────────────────────────────────────────────────────

const STARTED = new Set(['in_progress', 'in_review', 'returned']);

/** Started or done tasks are never moved automatically (spec: Scheduling rules). */
export function isFrozen(t: Pick<SchedTask, 'status' | 'statusBeforeBlock'>): boolean {
	if (t.status === 'done' || STARTED.has(t.status)) return true;
	return t.status === 'blocked' && !!t.statusBeforeBlock && STARTED.has(t.statusBeforeBlock);
}

/** Whether window rules apply to this task: enforced series, windowed stage, not a gate. */
export function isWindowed(t: SchedTask, rules: WindowRules): boolean {
	return rules.enforce && !t.ignoresWindows && t.durationDays > 0;
}

export function allowanceFor(t: SchedTask, rules: WindowRules): number {
	return t.overflowAllowed ? rules.overflowDays : 0;
}

/** Whether the task, as currently dated, fits window `w` under the rules. */
export function fitsWindowFor(t: SchedTask, w: Win, rules: WindowRules): boolean {
	return fitsWindow(t.startDate, t.durationDays, w, rules.windows, allowanceFor(t, rules));
}

/** Earliest start allowed by predecessors, or null when the task has none. */
export function earliestStart(
	id: string,
	taskMap: Map<string, SchedTask>,
	predMap: Map<string, { id: string; lagDays: number }[]>
): string | null {
	let earliest: string | null = null;
	for (const pred of predMap.get(id) ?? []) {
		const p = taskMap.get(pred.id);
		if (!p) continue;
		const afterLag = addWorkingDays(p.endDate, pred.lagDays);
		// Gate: successor may start the same day. Task: the next working day.
		const cand = p.durationDays === 0 ? toWorkingDay(afterLag) : nextWorkingDay(afterLag);
		if (!earliest || cand > earliest) earliest = cand;
	}
	return earliest;
}

export type Placement = Pick<SchedTask, 'startDate' | 'endDate' | 'windowId' | 'scheduleState'>;

/**
 * Check a move or resize made by a coordinator. Such moves are never clamped: the task
 * must start inside a window and end within that window plus its overflow allowance.
 * The window is always the one the task starts in, whatever the client sent.
 */
export function checkExplicitMove(
	t: SchedTask,
	rules: WindowRules
): { ok: true; windowId: string | null } | { ok: false; reason: string } {
	if (!isWindowed(t, rules)) return { ok: true, windowId: null };
	const w = windowAt(t.startDate, rules.windows);
	if (!w) return { ok: false, reason: 'starts outside every window' };
	if (!fitsWindowFor(t, w, rules))
		return { ok: false, reason: t.overflowAllowed ? 'runs past its overflow allowance' : 'runs past the window edge' };
	return { ok: true, windowId: w.id };
}

/**
 * Where a not-started task lands when it may start no earlier than `minStart`.
 * Never pulls a task earlier. Under window rules it stays in the window it starts in
 * while it fits (using its overflow allowance), otherwise jumps to the earliest later
 * window with room, otherwise becomes unscheduled at the earliest dates it could run.
 */
export function settle(t: SchedTask, minStart: string, rules: WindowRules): Placement {
	const start = toWorkingDay(later(t.startDate, minStart));
	const end = deriveEnd(start, t.durationDays);
	if (!isWindowed(t, rules)) {
		// Nothing pushes it and no window applies: leave its dates exactly as they are.
		if (minStart <= t.startDate) return { startDate: t.startDate, endDate: t.endDate, windowId: null, scheduleState: 'scheduled' };
		return { startDate: start, endDate: end, windowId: null, scheduleState: 'scheduled' };
	}

	const allowance = allowanceFor(t, rules);
	const here = windowAt(start, rules.windows);
	if (here && fitsWindow(start, t.durationDays, here, rules.windows, allowance))
		return { startDate: start, endDate: end, windowId: here.id, scheduleState: 'scheduled' };

	const placed = placeInWindows(start, t.durationDays, rules.windows, allowance);
	if (placed) return { ...placed, scheduleState: 'scheduled' };
	return { startDate: start, endDate: end, windowId: null, scheduleState: 'unscheduled' };
}

const samePlacement = (a: Placement, b: Placement) =>
	a.startDate === b.startDate && a.endDate === b.endDate && a.windowId === b.windowId &&
	(a.scheduleState ?? 'scheduled') === (b.scheduleState ?? 'scheduled');

export function buildPredMap(deps: SchedDep[]) {
	const predMap = new Map<string, { id: string; lagDays: number }[]>();
	const succMap = new Map<string, string[]>();
	for (const dep of deps) {
		if (!succMap.has(dep.predecessorId)) succMap.set(dep.predecessorId, []);
		succMap.get(dep.predecessorId)!.push(dep.successorId);
		if (!predMap.has(dep.successorId)) predMap.set(dep.successorId, []);
		predMap.get(dep.successorId)!.push({ id: dep.predecessorId, lagDays: dep.lagDays });
	}
	return { predMap, succMap };
}

// ── Propagation ───────────────────────────────────────────────────────────────

export type PropResult = Map<string, Placement>;

/**
 * Walk successors breadth-first from the moved tasks, pushing any that now start
 * before their predecessors allow. Only pushes forward; successors that already start
 * late enough are left alone. Started and done tasks keep their dates (they are flagged
 * At risk elsewhere). Under window rules pushed tasks are re-placed with `settle`.
 *
 * @param taskMap Mutable; moved tasks must already hold their new dates. Pushed tasks are updated in place.
 * @returns Placement for every task (other than the moved ones) that changed.
 */
export function propagate(
	movedIds: Set<string>,
	taskMap: Map<string, SchedTask>,
	deps: SchedDep[],
	rules: WindowRules = NO_WINDOWS
): PropResult {
	const { predMap, succMap } = buildPredMap(deps);
	const changed: PropResult = new Map();
	const queue = [...movedIds];

	while (queue.length > 0) {
		const tid = queue.shift()!;
		for (const succId of succMap.get(tid) ?? []) {
			const succ = taskMap.get(succId);
			if (!succ || isFrozen(succ)) continue;

			const earliest = earliestStart(succId, taskMap, predMap);
			if (!earliest || succ.startDate >= earliest) continue;

			const next = settle(succ, earliest, rules);
			if (samePlacement(next, succ)) continue;
			taskMap.set(succId, { ...succ, ...next });
			changed.set(succId, next);
			queue.push(succId);
		}
	}

	return changed;
}

// ── Status-transition validation ──────────────────────────────────────────────

const ALLOWED: Record<string, string[]> = {
	not_started: ['in_progress', 'blocked'],
	in_progress: ['in_review', 'done', 'blocked'],
	in_review:   ['done', 'returned', 'blocked'],
	returned:    ['in_progress', 'blocked'],
	blocked:     ['not_started', 'in_progress', 'in_review', 'returned'],
	done:        [],
};

export function isAllowedTransition(from: string, to: string): boolean {
	return from === to || (ALLOWED[from]?.includes(to) ?? false);
}
