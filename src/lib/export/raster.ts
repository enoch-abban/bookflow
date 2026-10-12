// Browser side of image export: SVG to canvas, canvas to PNG or PDF, and the download itself.

import { jpegPdf } from './pdf.ts';
import type { Measure } from './swimlane-svg.ts';

// Browsers refuse canvases past a size: Safari at about 16.7 million pixels, all of them past
// 32,767 px a side (some at 16,384). Big plans are drawn at a lower scale to stay inside.
const MAX_PIXELS = 16_000_000;
const MAX_SIDE = 16_384;

/** Text widths from a canvas, in the same font the export draws with. */
export function canvasMeasure(): Measure {
	const ctx = document.createElement('canvas').getContext('2d');
	return (text, font) => {
		if (!ctx) return text.length * 6;
		ctx.font = font;
		return ctx.measureText(text).width;
	};
}

/** The SVG drawn onto a canvas at up to `scale` times its size (2: sharp on screens and in print). */
export async function svgToCanvas(svg: string, size: { width: number; height: number }, scale = 2): Promise<HTMLCanvasElement> {
	const s = Math.min(scale, Math.sqrt(MAX_PIXELS / (size.width * size.height)), MAX_SIDE / size.width, MAX_SIDE / size.height);
	const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
	try {
		const img = new Image();
		img.src = url;
		await img.decode();
		const canvas = document.createElement('canvas');
		canvas.width = Math.floor(size.width * s);
		canvas.height = Math.floor(size.height * s);
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('This browser cannot draw the image.');
		ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
		return canvas;
	} finally {
		URL.revokeObjectURL(url);
	}
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
	return new Promise((resolve, reject) =>
		canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The image was too large to create.'))), type, quality)
	);
}

export const pngBlob = (canvas: HTMLCanvasElement) => toBlob(canvas, 'image/png');

/** A one-page PDF of the canvas; the page is the image's size at 96 dpi, the screen's own scale. */
export async function pdfBlob(canvas: HTMLCanvasElement, size: { width: number; height: number }, title: string): Promise<Blob> {
	const jpeg = new Uint8Array(await (await toBlob(canvas, 'image/jpeg', 0.92)).arrayBuffer());
	const pdf = jpegPdf(jpeg, { width: canvas.width, height: canvas.height }, { width: size.width * 0.75, height: size.height * 0.75 }, title);
	return new Blob([pdf as BlobPart], { type: 'application/pdf' });
}

export function download(blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
