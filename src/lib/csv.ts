// CSV for spreadsheet exports (RFC 4180): comma separated, CRLF line ends, fields quoted when
// they hold a comma, quote or line break. Pure functions, shared by every export.

export type CsvValue = string | number | boolean | null | undefined;

// A text cell starting with one of these is read as a formula by Excel, Sheets and LibreOffice,
// so a task title like "=HYPERLINK(...)" could run when the file is opened (CSV injection).
const FORMULA_START = /^[=+\-@\t\r]/;

/** One cell. Text that would start a formula gets a leading apostrophe; numbers stay numbers. */
export function csvCell(value: CsvValue): string {
	if (value === null || value === undefined) return '';
	if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
	if (typeof value === 'boolean') return value ? 'Yes' : 'No';
	const text = FORMULA_START.test(value) ? `'${value}` : value;
	return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A whole file: a header row, then one line per row, each ending in CRLF. */
export function toCsv(header: string[], rows: CsvValue[][]): string {
	return [header, ...rows].map((r) => r.map(csvCell).join(',') + '\r\n').join('');
}

/** A file name part from free text: "eSTEAM L2" → "esteam-l2". */
export function fileSlug(text: string): string {
	return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'export';
}
