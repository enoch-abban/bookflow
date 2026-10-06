// Window geometry: which window a date falls in, how far a task may run past it
// (overflow), and where a task fits. Pure functions; windows never overlap.

import { addWorkingDays, deriveEnd, toWorkingDay } from './calendar.ts';

export type Win = { id: string; startDate: string; endDate: string };

export function sortWindows<T extends Win>(wins: T[]): T[] {
	return [...wins].sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/** The window containing `date`, if any. `wins` must be sorted. */
export function windowAt(date: string, wins: Win[]): Win | null {
	return wins.find((w) => w.startDate <= date && date <= w.endDate) ?? null;
}

/** The first window that starts after `w` ends. */
export function nextWindow(w: Win, wins: Win[]): Win | null {
	return wins.find((x) => x.startDate > w.endDate) ?? null;
}

/**
 * Latest end date for a task that starts in `w`. The allowance counts working days past
 * the window's end (gaps included) but never past the next window's end, so a task crosses
 * at most one edge. After the last window the full allowance applies.
 */
export function latestEnd(w: Win, wins: Win[], allowance: number): string {
	if (allowance <= 0) return w.endDate;
	const raw = addWorkingDays(w.endDate, allowance);
	const next = nextWindow(w, wins);
	return next && next.endDate < raw ? next.endDate : raw;
}

export function fitsWindow(start: string, durationDays: number, w: Win, wins: Win[], allowance: number): boolean {
	return w.startDate <= start && start <= w.endDate && deriveEnd(start, durationDays) <= latestEnd(w, wins, allowance);
}

/** Earliest window with room for the task starting no earlier than `earliest`, or null. */
export function placeInWindows(
	earliest: string,
	durationDays: number,
	wins: Win[],
	allowance: number
): { startDate: string; endDate: string; windowId: string } | null {
	for (const w of wins) {
		if (w.endDate < earliest) continue;
		const start = toWorkingDay(earliest > w.startDate ? earliest : w.startDate);
		if (start > w.endDate) continue;
		if (fitsWindow(start, durationDays, w, wins, allowance))
			return { startDate: start, endDate: deriveEnd(start, durationDays), windowId: w.id };
	}
	return null;
}

/** Windows in a series may not overlap; returns the window `cand` collides with. */
export function overlapping(cand: { id?: string; startDate: string; endDate: string }, wins: Win[]): Win | null {
	return wins.find((w) => w.id !== cand.id && w.startDate <= cand.endDate && cand.startDate <= w.endDate) ?? null;
}
