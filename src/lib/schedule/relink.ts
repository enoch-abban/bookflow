// Relinking dependencies around removed tasks. Pure; used when skipping a stage and when
// removing a stage or a book.

export type DepRow = { id: string; predecessorId: string; successorId: string; lagDays: number };

/**
 * Dependencies to delete and bridges to add when `removeIds` go. Each remaining
 * predecessor is linked to each remaining successor reachable through removed tasks
 * (lags added), unless the remaining links already order them.
 */
export function planRelink(removeIds: Set<string>, deps: DepRow[], newId: () => string): { touching: DepRow[]; bridges: DepRow[] } {
	const touching = deps.filter((d) => removeIds.has(d.predecessorId) || removeIds.has(d.successorId));
	const remaining: Pick<DepRow, 'predecessorId' | 'successorId'>[] = deps.filter((d) => !removeIds.has(d.predecessorId) && !removeIds.has(d.successorId));
	const out = new Map<string, DepRow[]>();
	for (const d of deps) out.set(d.predecessorId, [...(out.get(d.predecessorId) ?? []), d]);

	const reachable = (from: string, to: string) => {
		const queue = [from];
		const seen = new Set<string>();
		while (queue.length) {
			const cur = queue.shift()!;
			if (cur === to) return true;
			if (seen.has(cur)) continue;
			seen.add(cur);
			for (const d of remaining) if (d.predecessorId === cur) queue.push(d.successorId);
		}
		return false;
	};

	const bridges: DepRow[] = [];
	for (const into of touching.filter((d) => !removeIds.has(d.predecessorId) && removeIds.has(d.successorId))) {
		// Walk forward through removed tasks to the first remaining ones.
		const stack = [{ at: into.successorId, lag: into.lagDays }];
		const seen = new Set<string>();
		while (stack.length) {
			const { at, lag } = stack.pop()!;
			if (seen.has(at)) continue;
			seen.add(at);
			for (const d of out.get(at) ?? []) {
				if (removeIds.has(d.successorId)) stack.push({ at: d.successorId, lag: lag + d.lagDays });
				else if (d.successorId !== into.predecessorId && !reachable(into.predecessorId, d.successorId)) {
					const bridge = { id: newId(), predecessorId: into.predecessorId, successorId: d.successorId, lagDays: lag + d.lagDays };
					bridges.push(bridge);
					remaining.push(bridge);
				}
			}
		}
	}
	return { touching, bridges };
}
