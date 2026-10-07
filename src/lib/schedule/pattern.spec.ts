import { describe, expect, it } from 'vitest';
import { bookLinks, type StageLink } from './pattern.ts';

const L = (from: string, to: string, lagDays = 0): StageLink => ({ from, to, lagDays });
const edges = (ls: StageLink[]) => ls.map((l) => `${l.from}>${l.to}${l.lagDays ? `+${l.lagDays}` : ''}`).sort();

// review -> layout -> plr -> correction -> gate -> print; publishing runs alongside: review -> submit -> isbn -> gate
const pattern = [
	L('review', 'layout'), L('layout', 'plr'), L('plr', 'correction'), L('correction', 'gate'),
	L('review', 'submit'), L('submit', 'isbn'), L('isbn', 'gate'), L('gate', 'print')
];

describe('book dependency pattern', () => {
	it('links every pair of stages the book has', () => {
		const all = new Set(['review', 'layout', 'plr', 'correction', 'submit', 'isbn', 'gate', 'print']);
		expect(bookLinks(all, pattern)).toHaveLength(pattern.length);
	});

	it('bridges a skipped stage, adding lags', () => {
		const p = [L('a', 'b', 1), L('b', 'c', 2)];
		expect(edges(bookLinks(new Set(['a', 'c']), p))).toEqual(['a>c+3']);
	});

	it('adds no redundant bridge when a whole branch is skipped', () => {
		// Publishing and the gate skipped (as for the Rev 5 import): no review -> print shortcut.
		const present = new Set(['review', 'layout', 'plr', 'print']);
		expect(edges(bookLinks(present, pattern))).toEqual(['layout>plr', 'plr>print', 'review>layout']);
	});

	it('drops a bridge implied by another bridge, whatever order they are found in', () => {
		// a -> x(skipped) -> c and a -> b -> y(skipped) -> c: a reaches c through b already.
		const p = [L('a', 'x'), L('x', 'c'), L('a', 'b'), L('b', 'y'), L('y', 'c')];
		expect(edges(bookLinks(new Set(['a', 'b', 'c']), p))).toEqual(['a>b', 'b>c']);
		expect(edges(bookLinks(new Set(['a', 'b', 'c']), [...p].reverse()))).toEqual(['a>b', 'b>c']);
	});

	it('keeps a parallel branch when only part of the chain is skipped', () => {
		// Correction skipped, publishing kept: plr bridges to the gate, which also waits for the ISBN.
		const present = new Set(['review', 'layout', 'plr', 'submit', 'isbn', 'gate', 'print']);
		expect(edges(bookLinks(present, pattern))).toEqual(
			['gate>print', 'isbn>gate', 'layout>plr', 'plr>gate', 'review>layout', 'review>submit', 'submit>isbn']
		);
	});
});
