import { describe, expect, it } from 'vitest';
import { jpegPdf } from './pdf.ts';

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
const latin1 = (b: Uint8Array) => Array.from(b, (x) => String.fromCharCode(x)).join('');

describe('jpegPdf', () => {
	const pdf = jpegPdf(jpeg, { width: 400, height: 200 }, { width: 300, height: 150 }, 'eSTEAM L2 — swimlane');
	const text = latin1(pdf);

	it('is a PDF that ends properly', () => {
		expect(text.startsWith('%PDF-1.4\n')).toBe(true);
		expect(text.endsWith('%%EOF\n')).toBe(true);
	});

	it('holds the image bytes unchanged, with their length and pixel size', () => {
		expect(text).toContain(`/Width 400 /Height 200`);
		expect(text).toContain(`/Filter /DCTDecode /Length ${jpeg.length}`);
		expect(text).toContain(latin1(jpeg));
	});

	it('sizes the page and draws the image across it', () => {
		expect(text).toContain('/MediaBox [0 0 300 150]');
		expect(text).toContain('q 300 0 0 150 0 0 cm /Im0 Do Q');
	});

	it('points every cross-reference entry at its object', () => {
		const xrefAt = Number(/startxref\n(\d+)\n/.exec(text)![1]);
		expect(text.slice(xrefAt, xrefAt + 4)).toBe('xref');
		const entries = [...text.slice(xrefAt).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
		expect(entries).toHaveLength(6);
		entries.forEach((offset, i) => expect(text.slice(offset, offset + 8)).toBe(`${i + 1} 0 obj\n`));
	});

	it('stores the title as UTF-16, so any character survives', () => {
		expect(text).toContain('/Title <FEFF0065005300540045');
		expect(text).toContain('2014'); // the em dash
	});
});
