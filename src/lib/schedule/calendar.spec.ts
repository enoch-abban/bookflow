import { describe, expect, it } from 'vitest';
import { workingDaysBetween } from './calendar.ts';

describe('working days between two dates', () => {
	it('counts working days forward and backward', () => {
		expect(workingDaysBetween('2026-10-14', '2026-10-16')).toBe(2); // Wed -> Fri
		expect(workingDaysBetween('2026-10-16', '2026-10-19')).toBe(1); // Fri -> Mon
		expect(workingDaysBetween('2026-10-19', '2026-10-14')).toBe(-3);
	});
	it('is zero for the same day', () => {
		expect(workingDaysBetween('2026-10-14', '2026-10-14')).toBe(0);
	});
});
