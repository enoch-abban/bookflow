import { describe, expect, it } from 'vitest';
import { reassignDrop, UNASSIGNED } from './reassign.ts';

describe('reassigning by drag', () => {
	const two = { personIds: ['a', 'b'], leadId: 'a' };

	it('swaps the person whose lane the bar left, keeping lead status', () => {
		expect(reassignDrop(two, 'a', 'c')).toEqual({ personIds: ['c', 'b'], leadId: 'c' });
		expect(reassignDrop(two, 'b', 'c')).toEqual({ personIds: ['a', 'c'], leadId: 'a' });
	});

	it('drops the person who left when the target already has the task', () => {
		expect(reassignDrop(two, 'a', 'b')).toEqual({ personIds: ['b'], leadId: 'b' });
		expect(reassignDrop(two, 'b', 'a')).toEqual({ personIds: ['a'], leadId: 'a' });
	});

	it('assigns from the Unassigned lane and unassigns into it', () => {
		expect(reassignDrop({ personIds: [], leadId: null }, UNASSIGNED, 'c')).toEqual({ personIds: ['c'], leadId: 'c' });
		expect(reassignDrop(two, 'b', UNASSIGNED)).toEqual({ personIds: [], leadId: null });
	});

	it('changes nothing for a drop in the same lane, or from a lane the task has left', () => {
		expect(reassignDrop(two, 'a', 'a')).toBeNull();
		expect(reassignDrop(two, 'z', 'c')).toBeNull();
		expect(reassignDrop({ personIds: [], leadId: null }, UNASSIGNED, UNASSIGNED)).toBeNull();
	});
});
