// The swimlane as one standalone SVG, for PNG and PDF export (spec: Phase 2, export of the
// swimlane). The component supplies the geometry it already draws with; this turns it into
// shapes in the same styles as the screen. Pure: no DOM, so it can be tested.

export type SvgBar = {
	x: number; y: number; w: number; h: number;
	label: string;
	category: string;
	status: string;
	unscheduled?: boolean;
	/** Where the window edge falls inside the bar, and the "+2d" badge for the part past it. */
	overflow?: { x: number; label: string };
	outside?: boolean;
	critical?: boolean;
	dim?: boolean;
};

export type SwimlaneModel = {
	title: string;
	subtitle: string;
	labelW: number;
	/** Width of the timeline, without the label column. */
	width: number;
	winRow: number;
	dayRow: number;
	windows: { x: number; w: number; label: string; tint: string; edge: string }[];
	days: { x: number; w: number; label: string; month: string | null }[];
	offDays: { x: number; w: number; holiday: boolean }[];
	gaps: { x: number; w: number }[];
	groups: { y: number; h: number; label: string }[];
	lanes: { y: number; h: number; label: string; sublabel?: string }[];
	bodyH: number;
	bars: SvgBar[];
	gates: { cx: number; cy: number; critical?: boolean; dim?: boolean }[];
	arrows: { d: string; violated: boolean }[];
	todayX?: number;
	targetX?: number;
	/** Theme tokens by name without the dashes, e.g. colors.background. */
	colors: Record<string, string>;
};

export const EXPORT_FONT = `Inter, system-ui, 'Segoe UI', Roboto, sans-serif`;
const TITLE_H = 56;
const LEGEND = 'Outline: not started · Solid: in progress · Striped: in review · Dashed: returned · Faded ✓: done · Red edge: blocked';

/** Stage category → [fill, text] tokens, as the .cat-* classes on screen. */
const CATEGORY: Record<string, [string, string]> = {
	creation: ['primary-subtle', 'primary-subtle-foreground'],
	review: ['secondary-subtle', 'secondary-foreground'],
	layout: ['tertiary-subtle', 'tertiary-foreground'],
	publish: ['publish-subtle', 'publish-foreground'],
	production: ['production-subtle', 'production'],
	gate: ['background', 'muted-foreground']
};

export function escapeXml(text: string): string {
	return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}

/** Text width in px; the component passes a canvas measure, tests use the rough default. */
export type Measure = (text: string, font: string) => number;
const roughMeasure: Measure = (text, font) => text.length * (parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? '11') * 0.56);

/** `text` cut to fit `max` px, ending in "…" when cut. */
export function fitText(text: string, max: number, font: string, measure: Measure = roughMeasure): string {
	if (max <= 0) return '';
	if (measure(text, font) <= max) return text;
	let lo = 0;
	let hi = text.length;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (measure(text.slice(0, mid).trimEnd() + '…', font) <= max) lo = mid;
		else hi = mid - 1;
	}
	return lo ? text.slice(0, lo).trimEnd() + '…' : '';
}

export function swimlaneSize(m: SwimlaneModel) {
	return { width: Math.ceil(m.labelW + m.width), height: Math.ceil(TITLE_H + m.winRow + m.dayRow + m.bodyH) };
}

export function swimlaneSvg(m: SwimlaneModel, measure: Measure = roughMeasure): string {
	const c = (token: string) => m.colors[token] ?? '#000';
	const { width, height } = swimlaneSize(m);
	const axisY = TITLE_H;
	const axisH = m.winRow + m.dayRow;
	const bodyY = axisY + axisH;
	const tx = (x: number) => m.labelW + x; // timeline x → image x
	const out: string[] = [];
	const push = (s: string) => out.push(s);
	const text = (x: number, y: number, s: string, attrs: string) => push(`<text x="${x}" y="${y}" ${attrs}>${escapeXml(s)}</text>`);

	push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${escapeXml(EXPORT_FONT)}">`);
	push(`<defs>
<pattern id="review" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="4" height="8" fill="rgba(0,0,0,0.07)"/></pattern>
<pattern id="unsched" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="12" fill="rgba(0,0,0,0.08)"/></pattern>
<marker id="ah" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M 0 0 L 6 3 L 0 6 Z" fill="${c('muted-foreground')}"/></marker>
<marker id="ah-v" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M 0 0 L 6 3 L 0 6 Z" fill="${c('danger')}"/></marker>
</defs>`);
	push(`<rect width="${width}" height="${height}" fill="${c('background')}"/>`);

	// Title band: series and view, then when it was exported; the status key on the right.
	text(16, 24, m.title, `font-size="16" font-weight="700" fill="${c('foreground')}"`);
	text(16, 43, m.subtitle, `font-size="11" fill="${c('muted-foreground')}"`);
	text(width - 16, 43, LEGEND, `font-size="10" fill="${c('muted-foreground')}" text-anchor="end"`);
	push(`<line x1="0" y1="${TITLE_H - 0.5}" x2="${width}" y2="${TITLE_H - 0.5}" stroke="${c('border')}"/>`);

	// Body background: non-working days, window gutters, window edges, today and target.
	for (const d of m.offDays) push(`<rect x="${tx(d.x)}" y="${bodyY}" width="${d.w}" height="${m.bodyH}" fill="${c(d.holiday ? 'tertiary-subtle' : 'weekend')}"/>`);
	for (const g of m.gaps) push(`<rect x="${tx(g.x)}" y="${bodyY}" width="${g.w}" height="${m.bodyH}" fill="${c('muted')}" opacity="0.6"/>`);
	for (const w of m.windows) {
		push(`<line x1="${tx(w.x) + 0.5}" y1="${bodyY}" x2="${tx(w.x) + 0.5}" y2="${bodyY + m.bodyH}" stroke="${w.edge}" opacity="0.4"/>`);
		push(`<line x1="${tx(w.x + w.w) - 0.5}" y1="${bodyY}" x2="${tx(w.x + w.w) - 0.5}" y2="${bodyY + m.bodyH}" stroke="${w.edge}" opacity="0.4"/>`);
	}
	if (m.todayX !== undefined) push(`<rect x="${tx(m.todayX) - 1}" y="${axisY}" width="2" height="${axisH + m.bodyH}" fill="${c('primary')}" opacity="0.35"/>`);
	if (m.targetX !== undefined) push(`<line x1="${tx(m.targetX)}" y1="${axisY}" x2="${tx(m.targetX)}" y2="${bodyY + m.bodyH}" stroke="${c('tertiary')}" stroke-width="2" stroke-dasharray="6 4" opacity="0.6"/>`);

	// Group headers and lane rows, with their labels in the left column.
	for (const g of m.groups) {
		push(`<rect x="0" y="${bodyY + g.y}" width="${width}" height="${g.h}" fill="${c('muted')}"/>`);
		push(`<line x1="0" y1="${bodyY + g.y + g.h - 0.5}" x2="${width}" y2="${bodyY + g.y + g.h - 0.5}" stroke="${c('border')}"/>`);
		text(m.labelW + 8, bodyY + g.y + g.h / 2 + 4, g.label.toUpperCase(), `font-size="11" font-weight="700" letter-spacing="0.06em" fill="${c('muted-foreground')}"`);
	}
	for (const l of m.lanes) {
		const y = bodyY + l.y;
		push(`<line x1="0" y1="${y + l.h - 0.5}" x2="${width}" y2="${y + l.h - 0.5}" stroke="${c('border')}"/>`);
		const mid = y + l.h / 2;
		const labelFont = '600 12px ' + EXPORT_FONT;
		if (l.sublabel) {
			text(10, mid - 2, fitText(l.label, m.labelW - 20, labelFont, measure), `font-size="12" font-weight="600" fill="${c('foreground')}"`);
			text(10, mid + 12, fitText(l.sublabel, m.labelW - 20, '10px ' + EXPORT_FONT, measure), `font-size="10" fill="${c('muted-foreground')}"`);
		} else {
			text(10, mid + 4, fitText(l.label, m.labelW - 20, labelFont, measure), `font-size="12" font-weight="600" fill="${c('foreground')}"`);
		}
	}
	push(`<line x1="${m.labelW - 0.5}" y1="${axisY}" x2="${m.labelW - 0.5}" y2="${height}" stroke="${c('border')}"/>`);

	// Arrows under the bars, as on screen.
	for (const a of m.arrows) {
		push(`<path d="${a.d}" transform="translate(${m.labelW} ${bodyY})" fill="none" stroke="${c(a.violated ? 'danger' : 'muted-foreground')}" stroke-width="1.5" opacity="0.7" marker-end="url(#${a.violated ? 'ah-v' : 'ah'})"/>`);
	}

	for (const b of m.bars) push(barSvg(b, tx(b.x), bodyY + b.y, c, measure));
	for (const g of m.gates) {
		const cx = tx(g.cx);
		const cy = bodyY + g.cy;
		const r = 12.7; // an 18px square turned 45°
		const op = g.dim ? ' opacity="0.4"' : '';
		if (g.critical) push(`<polygon points="${cx},${cy - r - 3} ${cx + r + 3},${cy} ${cx},${cy + r + 3} ${cx - r - 3},${cy}" fill="none" stroke="${c('primary-active')}" stroke-width="2"/>`);
		push(`<polygon points="${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}" fill="${c('background')}" stroke="${c('muted-foreground')}" stroke-width="2"${op}/>`);
	}

	// Time axis: window bands, then the day row with the month at each month's first day.
	push(`<rect x="0" y="${axisY}" width="${width}" height="${axisH}" fill="${c('background')}"/>`);
	for (const w of m.windows) {
		const x = tx(w.x);
		push(`<rect x="${x}" y="${axisY}" width="${w.w}" height="${m.winRow}" fill="${w.tint}"/>`);
		push(`<rect x="${x}" y="${axisY}" width="2" height="${m.winRow}" fill="${w.edge}"/><rect x="${x + w.w - 2}" y="${axisY}" width="2" height="${m.winRow}" fill="${w.edge}"/>`);
		text(x + 8, axisY + m.winRow / 2 + 3.5, fitText(w.label, w.w - 12, '600 10px ' + EXPORT_FONT, measure), `font-size="10" font-weight="600" letter-spacing="0.02em" fill="${c('muted-foreground')}"`);
	}
	const dayY = axisY + m.winRow;
	for (const d of m.days) {
		const x = tx(d.x);
		push(`<line x1="${x + 0.5}" y1="${dayY}" x2="${x + 0.5}" y2="${dayY + m.dayRow}" stroke="${c('border')}"/>`);
		if (d.month) text(x + d.w / 2, dayY + 10, d.month.toUpperCase(), `font-size="9" font-weight="600" letter-spacing="0.04em" fill="${c('muted-foreground')}" opacity="0.7" text-anchor="middle"`);
		text(x + d.w / 2, dayY + m.dayRow - 5, d.label, `font-size="11" fill="${c('muted-foreground')}" text-anchor="middle"`);
	}
	if (m.todayX !== undefined) push(`<rect x="${tx(m.todayX) - 1}" y="${axisY}" width="2" height="${axisH}" fill="${c('primary')}" opacity="0.5"/>`);
	push(`<line x1="0" y1="${bodyY - 0.5}" x2="${width}" y2="${bodyY - 0.5}" stroke="${c('border')}"/>`);

	push('</svg>');
	return out.join('\n');
}

/** One bar in its category colours, with the status drawn as on screen (.st-* classes). */
function barSvg(b: SvgBar, x: number, y: number, c: (t: string) => string, measure: Measure): string {
	const [fillToken, textToken] = CATEGORY[b.category] ?? CATEGORY.creation;
	const fg = c(textToken);
	const fill = c(fillToken);
	const opacity = (b.status === 'done' ? 0.45 : b.status === 'not_started' ? 0.65 : b.status === 'returned' ? 0.85 : 1) * (b.dim ? 0.4 : 1);
	const parts: string[] = [];
	const rect = (attrs: string, inset = 0) =>
		parts.push(`<rect x="${x + inset}" y="${y + inset}" width="${Math.max(0, b.w - 2 * inset)}" height="${b.h - 2 * inset}" rx="4" ${attrs}/>`);

	if (b.status === 'not_started') rect(`fill="none" stroke="${fg}" stroke-width="1.5"`, 0.75);
	else rect(`fill="${fill}"`);
	if (b.status === 'in_review') rect('fill="url(#review)"');
	if (b.unscheduled) rect('fill="url(#unsched)"');
	if (b.status === 'returned') rect(`fill="none" stroke="${fg}" stroke-width="2" stroke-dasharray="5 3"`, 1);
	if (b.status === 'blocked') rect(`fill="none" stroke="${c('danger')}" stroke-width="2"`, 1);
	if (b.overflow) {
		const ox = x + b.overflow.x;
		parts.push(`<rect x="${ox}" y="${y}" width="${Math.max(0, x + b.w - ox)}" height="${b.h}" fill="${c('background')}" opacity="0.6"/>`);
		parts.push(`<line x1="${ox + 1}" y1="${y}" x2="${ox + 1}" y2="${y + b.h}" stroke="${fg}" stroke-width="2" stroke-dasharray="4 3"/>`);
	}

	const mark = b.status === 'done' ? '✓' : b.status === 'returned' ? '↩' : '';
	const badge = b.overflow?.label ?? '';
	const reserve = (mark ? 14 : 0) + (badge ? 26 : 0);
	const font = '500 11px ' + EXPORT_FONT;
	const label = fitText(b.label, b.w - 16 - reserve, font, measure);
	const mid = y + b.h / 2 + 4;
	if (label) parts.push(`<text x="${x + 8}" y="${mid}" font-size="11" font-weight="500" fill="${fg}">${escapeXml(label)}</text>`);
	if (mark) parts.push(`<text x="${x + b.w - 6}" y="${mid}" font-size="12" fill="${fg}" text-anchor="end">${mark}</text>`);
	if (badge) parts.push(`<text x="${x + b.w - 6 - (mark ? 14 : 0)}" y="${mid}" font-size="10" font-weight="700" fill="${c('foreground')}" text-anchor="end">${escapeXml(badge)}</text>`);

	const ring: string[] = [];
	if (b.outside) ring.push(`<rect x="${x - 3}" y="${y - 3}" width="${b.w + 6}" height="${b.h + 6}" rx="6" fill="none" stroke="${c('danger')}" stroke-width="2" stroke-dasharray="5 3"/>`);
	if (b.critical) ring.push(`<rect x="${x - 2}" y="${y - 2}" width="${b.w + 4}" height="${b.h + 4}" rx="5" fill="none" stroke="${c('primary-active')}" stroke-width="2"/>`);
	return `<g opacity="${opacity}">${parts.join('')}</g>${ring.join('')}`;
}
