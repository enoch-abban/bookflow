// Working-day scheduler. Holidays table is populated by admins; for now we
// ship with an empty table and use Mon-Fri as working days.

export type SchedTask = {
	id: string;
	startDate: string;
	endDate: string;
	durationDays: number;
	status: string;
	windowId: string | null;
};

export type SchedDep = {
	predecessorId: string;
	successorId: string;
	lagDays: number;
};

// ── Date helpers ─────────────────────────────────────────────────────────────

export function addWorkingDays(date: string, n: number): string {
	if (n === 0) return date;
	const d = new Date(date + 'T12:00:00Z');
	let count = 0;
	const sign = n > 0 ? 1 : -1;
	while (count < Math.abs(n)) {
		d.setUTCDate(d.getUTCDate() + sign);
		if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) count++;
	}
	return d.toISOString().slice(0, 10);
}

export function nextWorkingDay(date: string): string {
	const d = new Date(date + 'T12:00:00Z');
	while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
		d.setUTCDate(d.getUTCDate() + 1);
	}
	return d.toISOString().slice(0, 10);
}

export function isWorkingDay(date: string): boolean {
	const dow = new Date(date + 'T12:00:00Z').getUTCDay();
	return dow !== 0 && dow !== 6;
}

// Derive end date from start + durationDays
export function deriveEnd(start: string, durationDays: number): string {
	return durationDays === 0 ? start : addWorkingDays(start, durationDays - 1);
}

// ── Propagation ───────────────────────────────────────────────────────────────

export type PropResult = Map<string, { startDate: string; endDate: string }>;

/**
 * Walk successors in topological BFS order. Only pushes tasks forward —
 * never pulls them earlier. Tasks with status 'done' are skipped.
 *
 * @param movedIds  Set of task IDs whose dates were just changed.
 * @param taskMap   Mutable map; entries for moved IDs must already reflect
 *                  their new dates before this is called.
 * @param deps      All dependencies relevant to this series.
 * @returns         Map of taskId → { startDate, endDate } for every task
 *                  (other than the moved ones) that was pushed.
 */
export function propagate(
	movedIds: Set<string>,
	taskMap: Map<string, SchedTask>,
	deps: SchedDep[]
): PropResult {
	// Build adjacency lists
	const succMap = new Map<string, string[]>();
	const predMap = new Map<string, { id: string; lagDays: number }[]>();
	for (const dep of deps) {
		if (!succMap.has(dep.predecessorId)) succMap.set(dep.predecessorId, []);
		succMap.get(dep.predecessorId)!.push(dep.successorId);

		if (!predMap.has(dep.successorId)) predMap.set(dep.successorId, []);
		predMap.get(dep.successorId)!.push({ id: dep.predecessorId, lagDays: dep.lagDays });
	}

	const changed: PropResult = new Map();
	const queue = [...movedIds];
	const visited = new Set<string>(movedIds);

	while (queue.length > 0) {
		const tid = queue.shift()!;
		for (const succId of (succMap.get(tid) ?? [])) {
			const succ = taskMap.get(succId);
			if (!succ || succ.status === 'done') continue;

			// Compute earliest possible start from all predecessors
			let earliest: string | null = null;
			for (const pred of (predMap.get(succId) ?? [])) {
				const p = taskMap.get(pred.id);
				if (!p) continue;

				// Gate (durationDays=0): successor can start on the same day as the gate
				// Task: successor starts on the next working day after pred.end + lag
				const afterLag = addWorkingDays(p.endDate, pred.lagDays);
				const cand = p.durationDays === 0 ? afterLag : nextWorkingDay(afterLag);

				if (!earliest || cand > earliest) earliest = cand;
			}

			if (!earliest || succ.startDate >= earliest) continue; // no push needed

			const newStart = earliest;
			const newEnd   = deriveEnd(newStart, succ.durationDays);

			taskMap.set(succId, { ...succ, startDate: newStart, endDate: newEnd });
			changed.set(succId, { startDate: newStart, endDate: newEnd });

			if (!visited.has(succId)) {
				visited.add(succId);
				queue.push(succId);
			}
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
