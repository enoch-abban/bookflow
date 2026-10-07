// Deadline rules (spec: Deadlines). A stage may carry a rule relative to another stage
// of the same book, e.g. legal deposit within two calendar months of the ISBN being
// issued. The scheduler never moves a deadline; it only flags tasks that pass it.

export type DeadlineRule = { after: string; months?: number; days?: number };

export function parseRule(json: string | null | undefined): DeadlineRule | null {
	if (!json) return null;
	try {
		const r = JSON.parse(json);
		return r && typeof r.after === 'string' ? r : null;
	} catch {
		return null;
	}
}

/** `date` plus whole calendar months and days; a month-end date clamps (31 Jan + 1 month = 28 Feb). */
export function addCalendar(date: string, months = 0, days = 0): string {
	const [y, m, d] = date.split('-').map(Number);
	const target = new Date(Date.UTC(y, m - 1 + months, 1));
	const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
	target.setUTCDate(Math.min(d, lastDay) + days);
	return target.toISOString().slice(0, 10);
}

type DueTask = { id: string; bookId: string; stageId: string; endDate: string; status: string; dueDate: string | null };
type DueStage = { id: string; key: string; deadlineRule: string | null };

/**
 * Due dates implied by the stages' deadline rules, for tasks not yet Done.
 * Returns only the tasks whose due date would change.
 */
export function dueDateChanges(tasks: DueTask[], stages: DueStage[]): { id: string; from: string | null; to: string | null }[] {
	const stageById = new Map(stages.map((s) => [s.id, s]));
	const stageIdByKey = new Map(stages.map((s) => [s.key, s.id]));
	const byBookStage = new Map(tasks.map((t) => [`${t.bookId}:${t.stageId}`, t]));

	const out: { id: string; from: string | null; to: string | null }[] = [];
	for (const t of tasks) {
		if (t.status === 'done') continue;
		const rule = parseRule(stageById.get(t.stageId)?.deadlineRule);
		const base = rule ? byBookStage.get(`${t.bookId}:${stageIdByKey.get(rule.after)}`) : undefined;
		const due = rule && base ? addCalendar(base.endDate, rule.months ?? 0, rule.days ?? 0) : null;
		if (due !== t.dueDate) out.push({ id: t.id, from: t.dueDate, to: due });
	}
	return out;
}
