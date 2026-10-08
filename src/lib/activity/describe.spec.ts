import { describe as suite, expect, it } from 'vitest';
import { batchKind, describe, headline, type LogEntry, type Names } from './describe.ts';

const names: Names = {
	task: (id) => ({ t1: 'G3 Layout', t2: 'G3 Printing', t3: 'G4 Layout' } as Record<string, string>)[id],
	book: (id) => ({ b1: 'G3' } as Record<string, string>)[id],
	stage: (id) => ({ s1: 'Layout' } as Record<string, string>)[id],
	track: () => undefined, window: () => undefined, person: () => undefined,
};
const E = (entity: string, entityId: string, action: string, before: object | null, after: object | null): LogEntry =>
	({ id: Math.random().toString(), entity, entityId, action, before: before as LogEntry['before'], after: after as LogEntry['after'] });

suite('activity lines', () => {
	it('names tasks and gives date spans for moves', () => {
		expect(describe(E('task', 't1', 'move', { startDate: '2026-10-05', endDate: '2026-10-08' }, { startDate: '2026-10-07', endDate: '2026-10-12' }), names))
			.toBe('G3 Layout moved: Oct 5 – Oct 8 → Oct 7 – Oct 12');
		expect(describe(E('task', 't1', 'status', { status: 'in_progress' }, { status: 'done' }), names)).toBe('G3 Layout: In progress → Done');
	});

	it('words settings changes, holidays and skips', () => {
		expect(describe(E('series', 'x', 'update', { targetDate: '2026-11-24', version: 1 }, { targetDate: '2026-11-27', version: 2 }), names))
			.toBe('Series target date Nov 24 → Nov 27');
		expect(describe(E('holiday', '2026-12-25', 'create', null, { date: '2026-12-25', name: 'Christmas' }), names)).toBe('Added holiday Dec 25 (Christmas)');
		expect(describe(E('skip', 'k', 'create', null, { bookId: 'b1', stageId: 's1' }), names)).toBe('Skipped Layout for G3');
	});

	it('heads a batch with its main change and counts the tasks it pushed', () => {
		const batch = [
			E('series', 'x', 'update', { windowOverflowDays: 2 }, { windowOverflowDays: 0 }),
			E('task', 't1', 'move', { startDate: '2026-10-05', endDate: '2026-10-08' }, { startDate: '2026-10-09', endDate: '2026-10-14' }),
			E('task', 't2', 'move', { startDate: '2026-10-05', endDate: '2026-10-08' }, { startDate: '2026-10-09', endDate: '2026-10-14' }),
		];
		expect(headline(batch, names)).toBe('Series window overflow 2 → 0; 2 tasks moved');
		expect(headline([batch[1]], names)).toBe('G3 Layout moved: Oct 5 – Oct 8 → Oct 9 – Oct 14');
	});

	it('tells undo batches from changes', () => {
		const undo = [E('task', 't1', 'undo', { startDate: '2026-10-09' }, { startDate: '2026-10-05' }), E('task', 't3', 'undo', {}, {})];
		expect(batchKind(undo)).toBe('undo');
		expect(headline(undo, names)).toBe('Undid a change: 2 tasks');
		expect(batchKind([...undo, E('task', 't2', 'move', {}, {})])).toBe('change');
	});
});
