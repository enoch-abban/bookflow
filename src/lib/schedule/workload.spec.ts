import { afterEach, describe, expect, it } from 'vitest';
import { setHolidays } from './calendar.ts';
import { summarize, workload, type WLTask } from './workload.ts';

// October 2026: the 12th is a Monday.
const days = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'];
const T = (id: string, start: string, end: string, extra: Partial<WLTask> = {}): WLTask =>
	({ id, startDate: start, endDate: end, durationDays: 1, status: 'not_started', scheduleState: 'scheduled', ...extra });

describe('workload', () => {
	afterEach(() => setHolidays([]));

	it('gives every assignee one task day per working day the task spans', () => {
		const g = workload([T('a', '2026-10-12', '2026-10-14')], [{ taskId: 'a', personId: 'p' }, { taskId: 'a', personId: 'q' }], days);
		expect([...g.get('p')!.keys()]).toEqual(['2026-10-12', '2026-10-13', '2026-10-14']);
		expect(g.get('q')!.get('2026-10-13')).toEqual({ load: 1, taskIds: ['a'] });
	});

	it('adds up overlapping tasks and flags days over capacity', () => {
		const g = workload(
			[T('a', '2026-10-12', '2026-10-13'), T('b', '2026-10-13', '2026-10-14')],
			[{ taskId: 'a', personId: 'p' }, { taskId: 'b', personId: 'p' }], days
		);
		expect(g.get('p')!.get('2026-10-13')).toEqual({ load: 2, taskIds: ['a', 'b'] });
		expect(summarize(g.get('p'), 1)).toEqual({ peak: 2, over: 1, total: 4 });
		expect(summarize(g.get('p'), 2).over).toBe(0);
	});

	it('leaves out gates, unscheduled tasks, holidays and, by default, done work', () => {
		setHolidays(['2026-10-14']);
		const tasks = [
			T('gate', '2026-10-12', '2026-10-12', { durationDays: 0 }),
			T('later', '2026-10-12', '2026-10-12', { scheduleState: 'unscheduled' }),
			T('done', '2026-10-13', '2026-10-13', { status: 'done' }),
			T('span', '2026-10-13', '2026-10-15'),
		];
		const as = tasks.map((t) => ({ taskId: t.id, personId: 'p' }));
		expect([...workload(tasks, as, days).get('p')!.keys()]).toEqual(['2026-10-13', '2026-10-15']);
		expect(workload(tasks, as, days, { includeDone: true }).get('p')!.get('2026-10-13')!.load).toBe(2);
	});
});
