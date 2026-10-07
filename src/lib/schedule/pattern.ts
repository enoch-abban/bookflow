// The series' dependency pattern (stage_links) applied to one book. Links between two
// stages the book has become dependencies directly. Stages the book skips are bridged:
// a link into a skipped stage carries on to that stage's successors, adding the lags.
// A bridge is dropped when the book's other links already order the two stages, so
// skipping a whole branch (e.g. publishing) adds no redundant dependencies.

export type StageLink = { from: string; to: string; lagDays: number };

export function bookLinks(present: Set<string>, links: StageLink[]): StageLink[] {
	const out = links.filter((l) => present.has(l.from) && present.has(l.to));
	const next = new Map<string, StageLink[]>();
	for (const l of links) next.set(l.from, [...(next.get(l.from) ?? []), l]);

	// Bridges from each present stage through absent stages to the next present ones.
	const bridges: StageLink[] = [];
	for (const from of present) {
		const stack: { at: string; lag: number }[] = (next.get(from) ?? [])
			.filter((l) => !present.has(l.to))
			.map((l) => ({ at: l.to, lag: l.lagDays }));
		const seen = new Set<string>();
		while (stack.length) {
			const { at, lag } = stack.pop()!;
			if (seen.has(at)) continue;
			seen.add(at);
			for (const l of next.get(at) ?? []) {
				if (present.has(l.to)) bridges.push({ from, to: l.to, lagDays: lag + l.lagDays });
				else stack.push({ at: l.to, lag: lag + l.lagDays });
			}
		}
	}

	// Add every bridge, then drop each one the remaining links already imply. Checking
	// against the full set (not the bridges added so far) keeps the result independent
	// of the order bridges are found in.
	const key = (l: StageLink) => `${l.from}>${l.to}`;
	const unique = [...new Map(bridges.filter((b) => b.from !== b.to).map((b) => [key(b), b])).values()];
	const kept = new Set([...out, ...unique].map(key));
	const all = [...out, ...unique];
	const reaches = (a: string, b: string, without: string) => {
		const queue = [a];
		const seen = new Set<string>();
		while (queue.length) {
			const cur = queue.shift()!;
			if (cur === b) return true;
			if (seen.has(cur)) continue;
			seen.add(cur);
			for (const l of all) if (l.from === cur && kept.has(key(l)) && key(l) !== without) queue.push(l.to);
		}
		return false;
	};
	for (const b of unique) if (reaches(b.from, b.to, key(b))) kept.delete(key(b));
	return [...out, ...unique.filter((b) => kept.has(key(b)))];
}
