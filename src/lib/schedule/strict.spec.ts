import { describe, expect, it } from 'vitest';
import { deriveEnd, propagate, type SchedDep, type SchedTask } from './scheduler.ts';
import { conflictsOf, strictConflicts, tryMove } from './strict.ts';

// October 2026: the 12th is a Monday.
const task = (id: string, start: string, dur: number, extra: Partial<SchedTask> = {}): SchedTask => ({
	id, startDate: start, endDate: deriveEnd(start, dur), durationDays: dur, status: 'not_started',
	windowId: null, scheduleState: 'scheduled', version: 1, ...extra
});
const mapOf = (...ts: SchedTask[]) => new Map(ts.map((t) => [t.id, t]));
const link = (a: string, b: string, lagDays = 0): SchedDep => ({ predecessorId: a, successorId: b, lagDays });
const copy = (m: Map<string, SchedTask>) => new Map([...m].map(([k, v]) => [k, { ...v }]));

/** Move `id` to `start` and push its successors, as the schedule endpoint does. */
function move(m: Map<string, SchedTask>, deps: SchedDep[], id: string, start: string) {
	const after = copy(m);
	const t = after.get(id)!;
	after.set(id, { ...t, startDate: start, endDate: deriveEnd(start, t.durationDays) });
	propagate(new Set([id]), after, deps);
	return after;
}

describe('conflictsOf', () => {
	it('names the predecessor and counts the working days too early', () => {
		const m = mapOf(task('A', '2026-10-12', 3), task('B', '2026-10-13', 1)); // A ends Wed 14
		const [c] = conflictsOf({ taskMap: m, deps: [link('A', 'B')] }).values();
		expect(c).toMatchObject({ taskId: 'B', earliest: '2026-10-15', days: 2, predecessorIds: ['A'], frozen: false });
	});

	it('lets a gate\'s successor start the same day, and counts lags', () => {
		const gate = task('G', '2026-10-14', 0);
		expect(conflictsOf({ taskMap: mapOf(gate, task('B', '2026-10-14', 1)), deps: [link('G', 'B')] }).size).toBe(0);
		const m = mapOf(task('A', '2026-10-12', 1), task('B', '2026-10-14', 1)); // A ends Mon 12
		expect(conflictsOf({ taskMap: m, deps: [link('A', 'B', 2)] }).get('B')?.earliest).toBe('2026-10-15');
	});

	it('names only the predecessors that start it too early', () => {
		const m = mapOf(task('A', '2026-10-12', 3), task('X', '2026-10-12', 1), task('B', '2026-10-13', 1));
		expect(conflictsOf({ taskMap: m, deps: [link('A', 'B'), link('X', 'B')] }).get('B')?.predecessorIds).toEqual(['A']);
	});
});

describe('strictConflicts', () => {
	const base = mapOf(task('A', '2026-10-12', 2), task('B', '2026-10-14', 2), task('C', '2026-10-16', 1));
	const deps = [link('A', 'B'), link('B', 'C')];

	it('refuses moving a task before its predecessor allows', () => {
		const after = move(base, deps, 'B', '2026-10-13');
		const [c] = strictConflicts({ taskMap: base, deps }, { taskMap: after, deps }, ['B']);
		expect(c).toMatchObject({ taskId: 'B', predecessorIds: ['A'], frozen: false });
	});

	it('allows a move later that pushes not-started successors', () => {
		const after = move(base, deps, 'B', '2026-10-19');
		expect(after.get('C')!.startDate).toBe('2026-10-21');
		expect(strictConflicts({ taskMap: base, deps }, { taskMap: after, deps }, ['B'])).toEqual([]);
	});

	it('refuses a push that reaches a started task, naming it', () => {
		const started = copy(base);
		started.set('C', { ...started.get('C')!, status: 'in_progress' });
		const after = move(started, deps, 'B', '2026-10-19');
		const [c] = strictConflicts({ taskMap: started, deps }, { taskMap: after, deps }, ['B']);
		expect(c).toMatchObject({ taskId: 'C', frozen: true, predecessorIds: ['B'] });
	});

	it('refuses a new dependency that leaves a started task too early', () => {
		const m = mapOf(task('A', '2026-10-12', 3), task('B', '2026-10-13', 1, { status: 'in_progress' }));
		expect(strictConflicts({ taskMap: m, deps: [] }, { taskMap: m, deps: [link('A', 'B')] })).toHaveLength(1);
	});

	describe('conflicts that were there before', () => {
		// B already starts a day early (strict mode was off when it was dropped there).
		const early = mapOf(task('A', '2026-10-12', 2), task('B', '2026-10-13', 1), task('Z', '2026-10-12', 1));
		const d = [link('A', 'B')];

		it('pass while a change leaves them as they were', () => {
			const after = move(early, d, 'Z', '2026-10-19');
			expect(strictConflicts({ taskMap: early, deps: d }, { taskMap: after, deps: d }, ['Z'])).toEqual([]);
		});

		it('are refused when made worse', () => {
			// B has started, so a push cannot move it: A ending Wed 14 leaves it 2 days early, not 1.
			const startedB = copy(early);
			startedB.set('B', { ...startedB.get('B')!, status: 'in_progress' });
			const after = move(startedB, d, 'A', '2026-10-13');
			expect(strictConflicts({ taskMap: startedB, deps: d }, { taskMap: after, deps: d }, ['A']).map((c) => c.taskId)).toEqual(['B']);
		});

		it('are resolved, not refused, when a push can move the task', () => {
			const after = move(early, d, 'A', '2026-10-13');
			expect(after.get('B')!.startDate).toBe('2026-10-15');
			expect(strictConflicts({ taskMap: early, deps: d }, { taskMap: after, deps: d }, ['A'])).toEqual([]);
		});

		it('must be fixed by a move of the task itself', () => {
			const stillEarly = move(early, d, 'B', '2026-10-12');
			expect(strictConflicts({ taskMap: early, deps: d }, { taskMap: stillEarly, deps: d }, ['B'])).toHaveLength(1);
			const fixed = move(early, d, 'B', '2026-10-14');
			expect(strictConflicts({ taskMap: early, deps: d }, { taskMap: fixed, deps: d }, ['B'])).toEqual([]);
		});
	});
});

describe('tryMove', () => {
	const m = mapOf(task('A', '2026-10-12', 2), task('B', '2026-10-14', 2), task('C', '2026-10-16', 1, { status: 'in_progress' }));
	const plan = { taskMap: m, deps: [link('A', 'B'), link('B', 'C')] };
	const rules = { enforce: false, windows: [], overflowDays: 0 };

	it('allows positions that leave every task where its predecessors allow', () => {
		expect(tryMove(plan, 'B', { startDate: '2026-10-14', endDate: '2026-10-15', durationDays: 2 }, rules)).toEqual([]);
	});
	it('refuses positions before the predecessor, or that push the started task', () => {
		expect(tryMove(plan, 'B', { startDate: '2026-10-13', endDate: '2026-10-14', durationDays: 2 }, rules)[0].taskId).toBe('B');
		expect(tryMove(plan, 'B', { startDate: '2026-10-15', endDate: '2026-10-16', durationDays: 2 }, rules)[0]).toMatchObject({ taskId: 'C', frozen: true });
	});
	it('leaves the plan it was given untouched', () => {
		tryMove(plan, 'B', { startDate: '2026-10-19', endDate: '2026-10-20', durationDays: 2 }, rules);
		expect(m.get('B')!.startDate).toBe('2026-10-14');
	});
});
