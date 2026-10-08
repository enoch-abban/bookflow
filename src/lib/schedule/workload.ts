// Workload (spec: Workload view): assigned task days per person per working day,
// against each person's capacity. Every assignee of a task carries one task day for each
// working day it spans; gates take no capacity and unscheduled tasks are not placed.

import { isWorkingDay } from './calendar.ts';

export type WLTask = {
	id: string; startDate: string; endDate: string; durationDays: number; status: string; scheduleState: string;
};
export type WLAssignee = { taskId: string; personId: string };
export type Cell = { load: number; taskIds: string[] };

/** person -> date -> cell, for the given working days. */
export function workload(tasks: WLTask[], assignees: WLAssignee[], days: string[], opts: { includeDone?: boolean } = {}) {
	const dayIndex = new Map(days.map((d, i) => [d, i]));
	const byTask = new Map<string, string[]>();
	for (const a of assignees) byTask.set(a.taskId, [...(byTask.get(a.taskId) ?? []), a.personId]);

	const grid = new Map<string, Map<string, Cell>>();
	for (const t of tasks) {
		if (t.durationDays === 0 || t.scheduleState === 'unscheduled') continue;
		if (t.status === 'done' && !opts.includeDone) continue;
		const people = byTask.get(t.id) ?? [];
		if (!people.length) continue;
		for (let d = t.startDate; d <= t.endDate; d = next(d)) {
			if (!dayIndex.has(d) || !isWorkingDay(d)) continue;
			for (const p of people) {
				const row = grid.get(p) ?? new Map<string, Cell>();
				const cell = row.get(d) ?? { load: 0, taskIds: [] };
				cell.load += 1;
				cell.taskIds.push(t.id);
				row.set(d, cell);
				grid.set(p, row);
			}
		}
	}
	return grid;
}

function next(date: string): string {
	const d = new Date(date + 'T12:00:00Z');
	d.setUTCDate(d.getUTCDate() + 1);
	return d.toISOString().slice(0, 10);
}

/** Per-person summary: the busiest day and how many days go over capacity. */
export function summarize(row: Map<string, Cell> | undefined, capacity: number) {
	let peak = 0;
	let over = 0;
	let total = 0;
	for (const c of row?.values() ?? []) {
		peak = Math.max(peak, c.load);
		total += c.load;
		if (c.load > capacity) over++;
	}
	return { peak, over, total };
}
