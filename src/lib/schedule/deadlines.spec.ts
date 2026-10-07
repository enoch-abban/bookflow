import { describe, expect, it } from 'vitest';
import { addCalendar, dueDateChanges, parseRule } from './deadlines.ts';

describe('deadline rules', () => {
	it('adds calendar months, clamping to the end of a shorter month', () => {
		expect(addCalendar('2026-10-23', 2)).toBe('2026-12-23');
		expect(addCalendar('2027-01-31', 1)).toBe('2027-02-28');
		expect(addCalendar('2026-12-23', 0, 10)).toBe('2027-01-02');
	});

	it('ignores malformed rules', () => {
		expect(parseRule('not json')).toBeNull();
		expect(parseRule('{"months":2}')).toBeNull();
		expect(parseRule(null)).toBeNull();
	});

	const stages = [
		{ id: 'isbn', key: 'isbn_issued', deadlineRule: null },
		{ id: 'dep', key: 'legal_deposit', deadlineRule: '{"after":"isbn_issued","months":2}' }
	];
	const t = (id: string, bookId: string, stageId: string, endDate: string, extra = {}) =>
		({ id, bookId, stageId, endDate, status: 'not_started', dueDate: null as string | null, ...extra });

	it('derives a due date from the same book\'s base task', () => {
		const tasks = [t('i1', 'b1', 'isbn', '2026-10-23'), t('d1', 'b1', 'dep', '2026-10-29'), t('i2', 'b2', 'isbn', '2026-10-28')];
		expect(dueDateChanges(tasks, stages)).toEqual([{ id: 'd1', from: null, to: '2026-12-23' }]);
	});

	it('clears a due date when the rule is removed, and skips Done tasks', () => {
		const noRule = stages.map((s) => ({ ...s, deadlineRule: null }));
		const tasks = [
			t('d1', 'b1', 'dep', '2026-10-29', { dueDate: '2026-12-23' }),
			t('d2', 'b2', 'dep', '2026-10-29', { dueDate: '2026-12-23', status: 'done' })
		];
		expect(dueDateChanges(tasks, noRule)).toEqual([{ id: 'd1', from: '2026-12-23', to: null }]);
	});

	it('reports nothing when due dates already match', () => {
		const tasks = [t('i1', 'b1', 'isbn', '2026-10-23'), t('d1', 'b1', 'dep', '2026-10-29', { dueDate: '2026-12-23' })];
		expect(dueDateChanges(tasks, stages)).toEqual([]);
	});
});
