import { describe, expect, it } from 'vitest';
import { deriveEnd, nextWorkingDay, propagate, settle, type SchedTask, type WindowRules } from './scheduler.ts';
import { latestEnd, overlapping, placeInWindows, sortWindows, type Win } from '../schedule/windows.ts';
import { withHolidays } from '../schedule/calendar.ts';
import { refit } from './refit.ts';

// October 2026: the 12th is a Monday.
const W1: Win = { id: 'w1', startDate: '2026-10-12', endDate: '2026-10-16' }; // Mon–Fri
const W2: Win = { id: 'w2', startDate: '2026-10-19', endDate: '2026-10-20' }; // Mon–Tue
const W3: Win = { id: 'w3', startDate: '2026-10-26', endDate: '2026-10-30' }; // after a gap
const wins = sortWindows([W3, W1, W2]);
const rules = (overflowDays = 2, enforce = true, w = wins): WindowRules => ({ enforce, windows: w, overflowDays });

const task = (id: string, start: string, dur: number, extra: Partial<SchedTask> = {}): SchedTask => ({
	id, startDate: start, endDate: deriveEnd(start, dur), durationDays: dur, status: 'not_started',
	windowId: null, scheduleState: 'scheduled', version: 1, ...extra
});
const mapOf = (...ts: SchedTask[]) => new Map(ts.map((t) => [t.id, t]));

describe('calendar', () => {
	it('nextWorkingDay is strictly after, skipping weekends', () => {
		expect(nextWorkingDay('2026-10-14')).toBe('2026-10-15');
		expect(nextWorkingDay('2026-10-16')).toBe('2026-10-19');
	});
});

describe('window overflow allowance', () => {
	it('is the window end when the task may not overflow', () => {
		expect(latestEnd(W1, wins, 0)).toBe('2026-10-16');
	});
	it('counts working days past the window end, capped at the next window end', () => {
		expect(latestEnd(W1, wins, 1)).toBe('2026-10-19');
		expect(latestEnd(W1, wins, 5)).toBe('2026-10-20'); // never crosses two edges
	});
	it('may run into a gap between windows', () => {
		expect(latestEnd(W2, wins, 2)).toBe('2026-10-22');
	});
	it('applies in full after the last window', () => {
		expect(latestEnd(W3, wins, 2)).toBe('2026-11-03');
	});
});

describe('placement', () => {
	it('finds the earliest later window with room', () => {
		expect(placeInWindows('2026-10-15', 3, wins, 0)).toEqual({ startDate: '2026-10-26', endDate: '2026-10-28', windowId: 'w3' });
	});
	it('counts the allowance when deciding a window has room', () => {
		expect(placeInWindows('2026-10-15', 3, wins, 1)).toEqual({ startDate: '2026-10-15', endDate: '2026-10-19', windowId: 'w1' });
	});
	it('returns null when no window has room', () => {
		expect(placeInWindows('2026-10-28', 4, wins, 0)).toBeNull();
	});
	it('detects overlapping windows', () => {
		expect(overlapping({ startDate: '2026-10-20', endDate: '2026-10-21' }, wins)?.id).toBe('w2');
		expect(overlapping({ id: 'w2', startDate: '2026-10-19', endDate: '2026-10-21' }, wins)).toBeNull();
	});
});

describe('settle', () => {
	it('uses the overflow allowance before jumping windows', () => {
		const t = task('a', '2026-10-15', 3, { overflowAllowed: true });
		expect(settle(t, '2026-10-15', rules())).toMatchObject({ startDate: '2026-10-15', endDate: '2026-10-19', windowId: 'w1' });
	});
	it('jumps to the next window with room when it would run past the allowance', () => {
		const t = task('a', '2026-10-16', 3, { overflowAllowed: true });
		expect(settle(t, '2026-10-16', rules(1))).toMatchObject({ startDate: '2026-10-19', windowId: 'w2' });
	});
	it('becomes unscheduled, keeping its earliest dates, when no window has room', () => {
		expect(settle(task('a', '2026-10-28', 4), '2026-10-28', rules(0))).toEqual({
			startDate: '2026-10-28', endDate: '2026-11-02', windowId: null, scheduleState: 'unscheduled'
		});
	});
	it('ignores windows for gates, exempt stages and unenforced series', () => {
		expect(settle(task('g', '2026-10-21', 0), '2026-10-21', rules()).windowId).toBeNull();
		expect(settle(task('p', '2026-10-21', 5, { ignoresWindows: true }), '2026-10-21', rules()).scheduleState).toBe('scheduled');
		expect(settle(task('a', '2026-10-28', 4), '2026-10-28', rules(0, false)).scheduleState).toBe('scheduled');
	});
});

describe('propagate', () => {
	it('starts a successor the working day after its predecessor ends', () => {
		const m = mapOf(task('a', '2026-10-12', 3), task('b', '2026-10-13', 1));
		const out = propagate(new Set(['a']), m, [{ predecessorId: 'a', successorId: 'b', lagDays: 0 }]);
		expect(out.get('b')).toMatchObject({ startDate: '2026-10-15', endDate: '2026-10-15' });
	});
	it('lets a successor start the same day as a gate', () => {
		const m = mapOf(task('g', '2026-10-14', 0), task('b', '2026-10-12', 1));
		expect(propagate(new Set(['g']), m, [{ predecessorId: 'g', successorId: 'b', lagDays: 0 }]).get('b')?.startDate).toBe('2026-10-14');
	});
	it('never moves started or done tasks, but keeps pushing past them', () => {
		const m = mapOf(task('a', '2026-10-12', 3), task('b', '2026-10-13', 1, { status: 'in_progress' }), task('c', '2026-10-13', 1));
		const deps = [
			{ predecessorId: 'a', successorId: 'b', lagDays: 0 },
			{ predecessorId: 'a', successorId: 'c', lagDays: 0 }
		];
		const out = propagate(new Set(['a']), m, deps);
		expect(out.has('b')).toBe(false);
		expect(out.get('c')?.startDate).toBe('2026-10-15');
	});
	it('treats a blocked task as started only if it was started before blocking', () => {
		const deps = [{ predecessorId: 'a', successorId: 'b', lagDays: 0 }];
		const blockedEarly = mapOf(task('a', '2026-10-12', 3), task('b', '2026-10-13', 1, { status: 'blocked', statusBeforeBlock: 'not_started' }));
		const blockedLate = mapOf(task('a', '2026-10-12', 3), task('b', '2026-10-13', 1, { status: 'blocked', statusBeforeBlock: 'in_review' }));
		expect(propagate(new Set(['a']), blockedEarly, deps).has('b')).toBe(true);
		expect(propagate(new Set(['a']), blockedLate, deps).has('b')).toBe(false);
	});
	it('re-places pushed tasks into the next window with room', () => {
		const m = mapOf(task('a', '2026-10-12', 4, { windowId: 'w1' }), task('b', '2026-10-15', 2, { windowId: 'w1' }));
		const out = propagate(new Set(['a']), m, [{ predecessorId: 'a', successorId: 'b', lagDays: 0 }], rules(0));
		expect(out.get('b')).toMatchObject({ startDate: '2026-10-19', endDate: '2026-10-20', windowId: 'w2' });
	});
});

describe('refit', () => {
	it('moves tasks out of a shrunk window and pushes their successors', () => {
		const shrunk = sortWindows([{ ...W1, endDate: '2026-10-14' }, W2, W3]);
		const m = mapOf(task('a', '2026-10-14', 2, { windowId: 'w1' }), task('b', '2026-10-19', 2, { windowId: 'w2' }));
		const res = refit(m, [{ predecessorId: 'a', successorId: 'b', lagDays: 0 }], rules(0, true, shrunk));
		expect(res.changes.map((c) => [c.id, c.kind, c.after.windowId, c.after.startDate])).toEqual([
			['a', 'moved', 'w2', '2026-10-19'],
			['b', 'moved', 'w3', '2026-10-26']
		]);
	});
	it('leaves started tasks in place and reports them Outside window', () => {
		const shrunk = sortWindows([{ ...W1, endDate: '2026-10-14' }, W2, W3]);
		const m = mapOf(task('a', '2026-10-14', 2, { windowId: 'w1', status: 'in_progress' }), task('d', '2026-10-13', 4, { windowId: 'w1', status: 'done' }));
		const res = refit(m, [], rules(0, true, shrunk));
		expect(res.changes).toEqual([]);
		expect(res.outsideWindow).toEqual(['a']);
	});
	it('assigns every task the window it starts in when enforcement is switched on', () => {
		const m = mapOf(task('a', '2026-10-13', 2), task('p', '2026-10-13', 2, { ignoresWindows: true }));
		const res = refit(m, [], rules(0));
		expect(res.changes).toEqual([expect.objectContaining({ id: 'a', kind: 'window', after: expect.objectContaining({ windowId: 'w1' }) })]);
	});
	it('moves nothing when enforcement is switched off, even a task with inconsistent stored dates', () => {
		const odd = { ...task('n', '2026-11-05', 5, { windowId: 'w3' }), endDate: '2026-11-09' };
		const res = refit(mapOf(odd), [], rules(0, false));
		expect(res.changes).toEqual([expect.objectContaining({ kind: 'window', after: expect.objectContaining({ startDate: '2026-11-05', endDate: '2026-11-09' }) })]);
	});
	it('clears windows and schedules unscheduled tasks when enforcement is off', () => {
		const m = mapOf(task('a', '2026-10-13', 2, { windowId: 'w1' }), task('u', '2026-11-02', 3, { scheduleState: 'unscheduled' }));
		const res = refit(m, [], rules(0, false));
		expect(res.changes.map((c) => [c.id, c.kind, c.after.windowId])).toEqual([['a', 'window', null], ['u', 'placed', null]]);
		expect(m.get('u')).toMatchObject({ startDate: '2026-11-02', scheduleState: 'scheduled' });
	});
	it('retries unscheduled tasks once a window is extended', () => {
		const extended = sortWindows([W1, W2, { ...W3, endDate: '2026-11-06' }]);
		const m = mapOf(task('u', '2026-11-02', 3, { scheduleState: 'unscheduled' }));
		const res = refit(m, [], rules(0, true, extended));
		expect(res.changes[0]).toMatchObject({ kind: 'placed', after: { startDate: '2026-11-02', windowId: 'w3', scheduleState: 'scheduled' } });
	});
	it('lays durations out again around a new holiday, pushing successors (rederive)', () => {
		const m = mapOf(task('a', '2026-11-30', 4), task('b', '2026-12-04', 1), task('d', '2026-11-30', 2, { status: 'in_progress' }));
		const deps = [{ predecessorId: 'a', successorId: 'b', lagDays: 0 }];
		const res = withHolidays(['2026-12-02'], () => refit(m, deps, rules(0, false), { rederive: true }));
		expect(m.get('a')).toMatchObject({ startDate: '2026-11-30', endDate: '2026-12-04' }); // 4 days around Wed 2 Dec
		expect(m.get('b')).toMatchObject({ startDate: '2026-12-07', endDate: '2026-12-07' });
		expect(res.changes.map((c) => c.id)).toEqual(['a', 'b']); // the started task never moves
	});

	it('makes a task unscheduled when lowering the allowance leaves no window with room', () => {
		const m = mapOf(task('a', '2026-10-28', 4, { windowId: 'w3', overflowAllowed: true }));
		expect(refit(m, [], rules(2)).changes).toEqual([]);
		expect(refit(m, [], rules(0)).changes[0]).toMatchObject({ kind: 'unscheduled' });
	});
});
