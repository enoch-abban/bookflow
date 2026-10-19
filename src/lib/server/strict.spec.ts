import { describe, expect, it } from 'vitest';
import { deriveEnd, type SchedDep, type SchedTask } from '#lib/schedule/scheduler.ts';
import { strictRefusal } from './strict.ts';

const task = (id: string, start: string, dur: number, extra: Partial<SchedTask> = {}): SchedTask => ({
	id, startDate: start, endDate: deriveEnd(start, dur), durationDays: dur, status: 'not_started',
	windowId: null, scheduleState: 'scheduled', version: 1, ...extra
});
const deps: SchedDep[] = [{ predecessorId: 'A', successorId: 'B', lagDays: 0 }];
const labels = new Map([['A', 'Overall Review · G9'], ['B', 'InDesign · G9']]);
const ctx = (strictMode: number) => ({ series: { strictMode } as never, labels });

const before = { taskMap: new Map([['A', task('A', '2026-10-12', 3)], ['B', task('B', '2026-10-15', 1)]]), deps };
const earlyB = { taskMap: new Map([['A', task('A', '2026-10-12', 3)], ['B', task('B', '2026-10-13', 1)]]), deps };

describe('strictRefusal', () => {
	it('lets everything through when strict mode is off', () => {
		expect(strictRefusal(ctx(0), before, earlyB, ['B'])).toBeNull();
	});

	it('refuses with 422 predecessor_conflict, naming the predecessor and the earliest day', async () => {
		const res = strictRefusal(ctx(1), before, earlyB, ['B'])!;
		expect(res.status).toBe(422);
		const body = await res.json();
		expect(body.error).toBe('predecessor_conflict');
		expect(body.message).toBe('Strict mode: InDesign · G9 cannot start before Thu 15 Oct, after Overall Review · G9.');
		expect(body.conflicts[0]).toMatchObject({ taskId: 'B', started: false, predecessors: [{ id: 'A', label: 'Overall Review · G9', endDate: '2026-10-14' }] });
	});

	it('leads with the started task that stopped a push', async () => {
		const started = { ...earlyB, taskMap: new Map([...earlyB.taskMap].map(([k, v]) => [k, k === 'B' ? { ...v, status: 'in_progress' } : v])) };
		const body = await strictRefusal(ctx(1), { ...before, taskMap: new Map([...before.taskMap].map(([k, v]) => [k, k === 'B' ? { ...v, status: 'in_progress', startDate: '2026-10-13', endDate: '2026-10-13' } : v])), deps: [] }, started)!.json();
		expect(body.message).toContain('InDesign · G9 has started, so it cannot be pushed');
		expect(body.conflicts[0].started).toBe(true);
	});
});
