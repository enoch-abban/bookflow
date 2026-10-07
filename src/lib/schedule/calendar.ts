// Working-day calendar (spec: Calendar): Monday to Friday, minus the dates in the
// holidays table the admin maintains. The holiday set is held here so every caller
// (scheduler, windows, swimlane) uses the same calendar; the server refreshes it from
// the database before scheduling, and pages pass it to the browser.

let holidays: ReadonlySet<string> = new Set();

export function setHolidays(dates: Iterable<string>) {
	holidays = new Set(dates);
}

export function getHolidays(): ReadonlySet<string> {
	return holidays;
}

/**
 * Run `fn` with a different holiday set, then restore the current one. `fn` must be
 * synchronous, so no other request can observe the temporary set.
 */
export function withHolidays<T>(dates: Iterable<string>, fn: () => T): T {
	const saved = holidays;
	holidays = new Set(dates);
	try {
		const result = fn();
		if (result instanceof Promise) throw new Error('withHolidays needs a synchronous function');
		return result;
	} finally {
		holidays = saved;
	}
}

export function isWeekend(date: string): boolean {
	const dow = new Date(date + 'T12:00:00Z').getUTCDay();
	return dow === 0 || dow === 6;
}

export function isHoliday(date: string): boolean {
	return holidays.has(date);
}

export function isWorkingDay(date: string): boolean {
	return !isWeekend(date) && !holidays.has(date);
}

/** Move n working days forward (or back when negative). n = 0 returns the date unchanged. */
export function addWorkingDays(date: string, n: number): string {
	if (n === 0) return date;
	const d = new Date(date + 'T12:00:00Z');
	let count = 0;
	const sign = n > 0 ? 1 : -1;
	while (count < Math.abs(n)) {
		d.setUTCDate(d.getUTCDate() + sign);
		if (isWorkingDay(d.toISOString().slice(0, 10))) count++;
	}
	return d.toISOString().slice(0, 10);
}

/** The first working day strictly after `date`. */
export function nextWorkingDay(date: string): string {
	return addWorkingDays(date, 1);
}

/** `date` itself if it is a working day, otherwise the next one. */
export function toWorkingDay(date: string): string {
	return isWorkingDay(date) ? date : nextWorkingDay(date);
}

/** End date from start + duration in working days; gates (0 days) end on their start. */
export function deriveEnd(start: string, durationDays: number): string {
	return durationDays === 0 ? start : addWorkingDays(start, durationDays - 1);
}

/**
 * Working days from `from` to `to`: positive when `to` is later, negative when earlier,
 * 0 when they fall on the same working day. Used for baseline variance.
 */
export function workingDaysBetween(from: string, to: string): number {
	if (from === to) return 0;
	const [a, b, sign] = from < to ? [from, to, 1] : [to, from, -1];
	let n = 0;
	for (let d = addWorkingDays(a, 1); d <= b; d = addWorkingDays(d, 1)) n++;
	return sign * n;
}
