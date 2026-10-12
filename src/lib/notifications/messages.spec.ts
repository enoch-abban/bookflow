import { describe, expect, it } from 'vitest';
import {
	handoffMessage, isLate, lateDigest, lateKey, lateMessage, readySuccessors, returnedMessage, reviewRequestMessage, shortDate
} from './messages.ts';

const task = { stage: 'InDesign', book: 'G9', series: 'eSTEAM L2', link: 'https://app.test/s/S?task=t1' };

describe('messages', () => {
	it('formats dates the short way', () => {
		expect(shortDate('2026-10-09')).toBe('Fri 9 Oct');
	});

	it('says what can start, after what, and when', () => {
		const m = handoffMessage({ ...task, start: '2026-10-15' }, ['Overall Review · G9', 'ISBN Issued · G9']);
		expect(m.subject).toBe('InDesign · G9 can start');
		expect(m.body).toContain('Overall Review · G9 and ISBN Issued · G9 are done, so InDesign · G9 in eSTEAM L2 can start.');
		expect(m.body).toContain('Thu 15 Oct');
		expect(m.body).toContain(task.link);
	});

	it('asks for a review, naming the round after the first', () => {
		expect(reviewRequestMessage({ ...task, round: 1 }, 'Designer 1').body).toContain('Designer 1 submitted InDesign · G9 in eSTEAM L2 for review.');
		expect(reviewRequestMessage({ ...task, round: 2 }, 'Designer 1').body).toContain('for review (round 2).');
	});

	it('passes on the reviewer\'s summary when work is returned', () => {
		const m = returnedMessage(task, 'Rev 1', 'Fix the headers\non pages 4 to 6');
		expect(m.subject).toBe('InDesign · G9 was returned');
		expect(m.body).toContain('  Fix the headers\n  on pages 4 to 6');
	});

	it('lists late tasks with who is on them, one email per person', () => {
		const a = lateMessage({ ...task, end: '2026-10-09', people: ['Designer 1'] });
		const b = lateMessage({ ...task, book: 'G8', end: '2026-10-08', people: [] });
		expect(a.body).toContain('InDesign · G9 in eSTEAM L2 (Designer 1) was due Fri 9 Oct.');
		expect(b.body).toContain('(nobody assigned)');
		expect(lateDigest([a]).subject).toBe('InDesign · G9 is late');
		const both = lateDigest([a, b]);
		expect(both.subject).toBe('2 tasks are now late');
		expect(both.body).toContain(a.body);
		expect(both.body).toContain(b.body);
	});
});

describe('readySuccessors', () => {
	const t = (id: string, status: string) => [id, { id, status }] as const;
	it('announces successors only once every predecessor is done', () => {
		const byId = new Map([t('a', 'done'), t('b', 'in_progress'), t('c', 'not_started'), t('d', 'not_started'), t('e', 'in_progress')]);
		const deps = [
			{ predecessorId: 'a', successorId: 'c' }, // c waits on a only: ready
			{ predecessorId: 'a', successorId: 'd' },
			{ predecessorId: 'b', successorId: 'd' }, // d still waits on b
			{ predecessorId: 'a', successorId: 'e' } // e has already started
		];
		expect(readySuccessors('a', deps, byId).map((s) => s.id)).toEqual(['c']);
	});
});

describe('lateness', () => {
	it('counts a task late the day after its end, until it is done', () => {
		const base = { status: 'in_progress', endDate: '2026-10-09', scheduleState: 'scheduled' };
		expect(isLate(base, '2026-10-09')).toBe(false);
		expect(isLate(base, '2026-10-12')).toBe(true);
		expect(isLate({ ...base, status: 'done' }, '2026-10-12')).toBe(false);
		expect(isLate({ ...base, scheduleState: 'unscheduled' }, '2026-10-12')).toBe(false);
	});

	it('keys the late notice by task and end date', () => {
		expect(lateKey({ id: 't1', endDate: '2026-10-09' })).toBe('late:t1:2026-10-09');
	});
});
