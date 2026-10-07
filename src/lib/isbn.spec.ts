import { describe, expect, it } from 'vitest';
import { isValidIsbn13, normalizeIsbn } from './isbn.ts';

describe('ISBN-13', () => {
	it('accepts valid ISBNs, with or without hyphens and spaces', () => {
		expect(isValidIsbn13('9780306406157')).toBe(true);
		expect(isValidIsbn13('978-0-306-40615-7')).toBe(true);
		expect(isValidIsbn13('979 10 90636 07 1')).toBe(true);
	});
	it('rejects a wrong check digit, a wrong prefix or a wrong length', () => {
		expect(isValidIsbn13('9780306406158')).toBe(false);
		expect(isValidIsbn13('9770306406157')).toBe(false);
		expect(isValidIsbn13('978030640615')).toBe(false);
		expect(isValidIsbn13('0306406152')).toBe(false); // ISBN-10
	});
	it('normalizes what people type', () => {
		expect(normalizeIsbn(' 978-0-306 40615-7 ')).toBe('9780306406157');
	});
});
