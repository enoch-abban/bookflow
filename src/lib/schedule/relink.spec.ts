import { describe, expect, it } from 'vitest';
import { planRelink, type DepRow } from './relink.ts';

let n = 0;
const id = () => `new${++n}`;
const D = (p: string, s: string, lagDays = 0): DepRow => ({ id: `${p}>${s}`, predecessorId: p, successorId: s, lagDays });
const pairs = (ds: DepRow[]) => ds.map((d) => `${d.predecessorId}>${d.successorId}${d.lagDays ? `+${d.lagDays}` : ''}`).sort();

describe('relinking around removed tasks', () => {
	it('links each predecessor to each successor of a removed task, adding lags', () => {
		const deps = [D('a', 'x', 1), D('b', 'x'), D('x', 'c', 2)];
		const { touching, bridges } = planRelink(new Set(['x']), deps, id);
		expect(pairs(touching)).toEqual(['a>x+1', 'b>x', 'x>c+2']);
		expect(pairs(bridges)).toEqual(['a>c+3', 'b>c+2']);
	});

	it('bridges through a chain of removed tasks (removing a whole book section)', () => {
		const deps = [D('a', 'x'), D('x', 'y'), D('y', 'c')];
		expect(pairs(planRelink(new Set(['x', 'y']), deps, id).bridges)).toEqual(['a>c']);
	});

	it('adds no bridge the remaining links already imply', () => {
		const deps = [D('a', 'x'), D('x', 'c'), D('a', 'b'), D('b', 'c')];
		expect(planRelink(new Set(['x']), deps, id).bridges).toEqual([]);
	});

	it('adds nothing when a removed task only has predecessors or only successors', () => {
		const deps = [D('a', 'x'), D('x', 'y')];
		expect(planRelink(new Set(['x', 'y']), deps, id).bridges).toEqual([]);
	});
});
