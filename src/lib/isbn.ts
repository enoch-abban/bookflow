// ISBN-13 checks, shared by the book page form and the server (spec: Recording ISBNs).

/** Digits only: spaces and hyphens as people type them are ignored. */
export function normalizeIsbn(input: string): string {
	return input.replace(/[\s-]/g, '');
}

/** A valid ISBN-13: 13 digits, a 978 or 979 prefix, and a correct check digit. */
export function isValidIsbn13(input: string): boolean {
	const s = normalizeIsbn(input);
	if (!/^(978|979)\d{10}$/.test(s)) return false;
	const sum = [...s.slice(0, 12)].reduce((acc, d, i) => acc + Number(d) * (i % 2 ? 3 : 1), 0);
	return (10 - (sum % 10)) % 10 === Number(s[12]);
}
