// Working-day calendar. Mon-Fri for now; the spec also excludes the holidays table,
// which is not wired in yet.

export function isWorkingDay(date: string): boolean {
	const dow = new Date(date + 'T12:00:00Z').getUTCDay();
	return dow !== 0 && dow !== 6;
}

/** Move n working days forward (or back when negative). n = 0 returns the date unchanged. */
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
