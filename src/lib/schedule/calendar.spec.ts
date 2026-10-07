import { afterEach, describe, expect, it } from 'vitest';
import { deriveEnd, isWorkingDay, nextWorkingDay, setHolidays, toWorkingDay, withHolidays, workingDaysBetween } from './calendar.ts';

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

describe('holidays', () => {
	afterEach(() => setHolidays([]));

	it('are not working days, and are skipped when counting', () => {
		setHolidays(['2026-12-04']); // Farmers' Day, a Friday
		expect(isWorkingDay('2026-12-04')).toBe(false);
		expect(deriveEnd('2026-11-30', 5)).toBe('2026-12-07'); // Mon to Mon, Friday off
		expect(nextWorkingDay('2026-12-03')).toBe('2026-12-07');
		expect(toWorkingDay('2026-12-04')).toBe('2026-12-07');
		expect(workingDaysBetween('2026-12-03', '2026-12-07')).toBe(1);
	});

	it('withHolidays applies a set only for the duration of the call', () => {
		setHolidays(['2026-12-25']);
		expect(withHolidays(['2026-12-04'], () => isWorkingDay('2026-12-04'))).toBe(false);
		expect(isWorkingDay('2026-12-04')).toBe(true);
		expect(isWorkingDay('2026-12-25')).toBe(false);
	});
});
