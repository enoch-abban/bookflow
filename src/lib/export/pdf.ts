// A one-page PDF holding one JPEG image, sized to the image: enough for exporting a chart
// without a PDF library. JPEG can go into a PDF as it is (DCTDecode), so no re-encoding.

const enc = new TextEncoder();

/** A PDF text string for any title: UTF-16BE in hex, which needs no escaping. */
function pdfText(s: string): string {
	let hex = 'FEFF';
	for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
	return `<${hex}>`;
}

/**
 * @param jpeg the image file's bytes
 * @param px the image's size in pixels
 * @param page the page size in points (1/72 inch); the image fills it
 */
export function jpegPdf(jpeg: Uint8Array, px: { width: number; height: number }, page: { width: number; height: number }, title = ''): Uint8Array {
	const W = +page.width.toFixed(2);
	const H = +page.height.toFixed(2);
	const draw = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
	const parts: Uint8Array[] = [];
	const offsets: number[] = [];
	let size = 0;
	const add = (chunk: string | Uint8Array) => {
		const bytes = typeof chunk === 'string' ? enc.encode(chunk) : chunk;
		parts.push(bytes);
		size += bytes.length;
	};
	const obj = (n: number, body: string) => {
		offsets[n] = size;
		add(`${n} 0 obj\n${body}\nendobj\n`);
	};

	add('%PDF-1.4\n');
	add(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // "%" and four high bytes: marks the file as binary
	obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
	obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
	obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
	offsets[4] = size;
	add(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${px.width} /Height ${px.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
	add(jpeg);
	add('\nendstream\nendobj\n');
	obj(5, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
	obj(6, `<< /Title ${pdfText(title)} /Producer (bookflow) >>`);

	const xref = size;
	add(`xref\n0 7\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`);
	add(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

	const out = new Uint8Array(size);
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}
