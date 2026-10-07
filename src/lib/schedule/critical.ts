// Critical path (spec: Projected dates): the chain of tasks with no slack before the
// projected finish. A backward pass from the finishing task gives each task the latest
// it may end without delaying the finish, using the same rules as propagation (a task's
// successor starts the next working day, a gate's the same day, plus any lag). Tasks
// that cannot slip at all, or are already late against it, are critical.

import { addWorkingDays, workingDaysBetween } from './calendar.ts';

export type CPTask = { id: string; startDate: string; endDate: string; durationDays: number; status: string };
export type CPDep = { predecessorId: string; successorId: string; lagDays: number };

/** Slack in working days for every task that leads to the finish; finish = latest end of `finishIds`. */
export function slack(tasks: CPTask[], deps: CPDep[], finishIds: string[]): Map<string, number> {
	const byId = new Map(tasks.map((t) => [t.id, t]));
	const finishers = finishIds.map((id) => byId.get(id)).filter((t): t is CPTask => !!t);
	if (!finishers.length) return new Map();
	const finish = finishers.reduce((m, t) => (t.endDate > m ? t.endDate : m), finishers[0].endDate);
	const targets = finishers.filter((t) => t.endDate === finish).map((t) => t.id);

	// Only tasks that lead to the finish count; work that follows it (legal deposit) does not.
	const preds = new Map<string, CPDep[]>();
	for (const d of deps) preds.set(d.successorId, [...(preds.get(d.successorId) ?? []), d]);
	const relevant = new Set<string>(targets);
	const queue = [...targets];
	while (queue.length) {
		const cur = queue.shift()!;
		for (const d of preds.get(cur) ?? []) if (byId.has(d.predecessorId) && !relevant.has(d.predecessorId)) {
			relevant.add(d.predecessorId);
			queue.push(d.predecessorId);
		}
	}

	// Latest finish, from the finish backwards (successors before predecessors).
	const succs = new Map<string, CPDep[]>();
	for (const d of deps) if (relevant.has(d.predecessorId) && relevant.has(d.successorId))
		succs.set(d.predecessorId, [...(succs.get(d.predecessorId) ?? []), d]);
	const latestFinish = new Map<string, string>();
	const latestStart = (t: CPTask, lf: string) => (t.durationDays === 0 ? lf : addWorkingDays(lf, -(t.durationDays - 1)));
	const visit = (id: string, path: Set<string>): string => {
		const known = latestFinish.get(id);
		if (known) return known;
		if (path.has(id)) return finish; // dependencies are acyclic; never loop if that breaks
		path.add(id);
		const t = byId.get(id)!;
		let lf = targets.includes(id) ? finish : null;
		for (const d of succs.get(id) ?? []) {
			const s = byId.get(d.successorId)!;
			const ls = latestStart(s, visit(s.id, path));
			// Inverse of propagation: a gate may end on its successor's start day, a task the day before.
			const bound = addWorkingDays(ls, -(d.lagDays + (t.durationDays === 0 ? 0 : 1)));
			if (!lf || bound < lf) lf = bound;
		}
		path.delete(id);
		latestFinish.set(id, lf ?? finish);
		return lf ?? finish;
	};

	const out = new Map<string, number>();
	for (const id of relevant) out.set(id, workingDaysBetween(byId.get(id)!.endDate, visit(id, new Set())));
	return out;
}

/** Tasks still to do that cannot slip without delaying the finish (slack of zero or less). */
export function criticalPath(tasks: CPTask[], deps: CPDep[], finishIds: string[]): Set<string> {
	const done = new Set(tasks.filter((t) => t.status === 'done').map((t) => t.id));
	return new Set([...slack(tasks, deps, finishIds)].filter(([id, s]) => s <= 0 && !done.has(id)).map(([id]) => id));
}
