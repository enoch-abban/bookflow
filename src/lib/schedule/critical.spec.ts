import { describe, expect, it } from 'vitest';
import { deriveEnd } from './calendar.ts';
import { criticalPath, slack, type CPTask } from './critical.ts';

// October 2026: the 12th is a Monday.
const T = (id: string, start: string, dur: number, status = 'not_started'): CPTask =>
	({ id, startDate: start, endDate: deriveEnd(start, dur), durationDays: dur, status });
const D = (p: string, s: string, lagDays = 0) => ({ predecessorId: p, successorId: s, lagDays });

describe('critical path', () => {
	// a (Mon-Tue) -> c (Wed-Fri) -> bind (Mon 19); b (Mon only) -> c has a day of slack.
	const tasks = [T('a', '2026-10-12', 2), T('b', '2026-10-12', 1), T('c', '2026-10-14', 3), T('bind', '2026-10-19', 1), T('dep', '2026-10-20', 1)];
	const deps = [D('a', 'c'), D('b', 'c'), D('c', 'bind'), D('bind', 'dep')];

	it('gives each task leading to the finish its slack in working days', () => {
		const s = slack(tasks, deps, ['bind']);
		expect(Object.fromEntries(s)).toEqual({ bind: 0, c: 0, a: 0, b: 1 });
	});

	it('marks the chain with no slack, ignoring work after the finish', () => {
		expect([...criticalPath(tasks, deps, ['bind'])].sort()).toEqual(['a', 'bind', 'c']);
	});

	it('leaves Done tasks out of the highlight but keeps them in the maths', () => {
		const withDone = tasks.map((t) => (t.id === 'a' ? { ...t, status: 'done' } : t));
		expect([...criticalPath(withDone, deps, ['bind'])].sort()).toEqual(['bind', 'c']);
	});

	it('lets a successor of a gate start the same day', () => {
		const g = [T('x', '2026-10-12', 1), T('gate', '2026-10-13', 0), T('print', '2026-10-13', 1)];
		const s = slack(g, [D('x', 'gate'), D('gate', 'print')], ['print']);
		expect(Object.fromEntries(s)).toEqual({ print: 0, gate: 0, x: 0 });
	});

	it('uses the latest finisher when several books bind', () => {
		const two = [T('a1', '2026-10-12', 1), T('bind1', '2026-10-13', 1), T('a2', '2026-10-12', 3), T('bind2', '2026-10-15', 1)];
		const d2 = [D('a1', 'bind1'), D('a2', 'bind2')];
		expect([...criticalPath(two, d2, ['bind1', 'bind2'])].sort()).toEqual(['a2', 'bind2']);
	});
});
