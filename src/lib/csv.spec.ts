import { describe, expect, it } from 'vitest';
import { csvCell, fileSlug, toCsv } from './csv.ts';

describe('csvCell', () => {
	it('leaves plain text and numbers alone', () => {
		expect(csvCell('Grade 9')).toBe('Grade 9');
		expect(csvCell(4)).toBe('4');
		expect(csvCell(-2)).toBe('-2');
	});

	it('writes empty cells for missing values and words for booleans', () => {
		expect(csvCell(null)).toBe('');
		expect(csvCell(undefined)).toBe('');
		expect(csvCell(NaN)).toBe('');
		expect(csvCell(true)).toBe('Yes');
		expect(csvCell(false)).toBe('No');
	});

	it('quotes commas, quotes and line breaks', () => {
		expect(csvCell('Review, then fix')).toBe('"Review, then fix"');
		expect(csvCell('the "final" pass')).toBe('"the ""final"" pass"');
		expect(csvCell('line one\nline two')).toBe('"line one\nline two"');
	});

	it('defuses text that a spreadsheet would run as a formula', () => {
		expect(csvCell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
		expect(csvCell('+1 day')).toBe("'+1 day");
		expect(csvCell('-see notes')).toBe("'-see notes");
		expect(csvCell('@everyone')).toBe("'@everyone");
	});
});

describe('toCsv', () => {
	it('ends every row, the header included, with CRLF', () => {
		expect(toCsv(['Book', 'Days'], [['G9', 4], ['N1', null]])).toBe('Book,Days\r\nG9,4\r\nN1,\r\n');
	});
});

describe('fileSlug', () => {
	it('makes a safe file name part', () => {
		expect(fileSlug('eSTEAM L2')).toBe('esteam-l2');
		expect(fileSlug('  Rev 5 / final ')).toBe('rev-5-final');
		expect(fileSlug('***')).toBe('export');
	});
});
