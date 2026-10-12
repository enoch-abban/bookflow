import { describe, expect, it } from 'vitest';
import { escapeXml, fitText, swimlaneSize, swimlaneSvg, type SwimlaneModel } from './swimlane-svg.ts';

const model = (over: Partial<SwimlaneModel> = {}): SwimlaneModel => ({
	title: 'eSTEAM L2',
	subtitle: 'Swimlane by book · exported 12 Oct 2026',
	labelW: 160,
	width: 400,
	winRow: 26,
	dayRow: 28,
	windows: [{ x: 0, w: 160, label: 'Oct 5 to 8', tint: '#eef', edge: '#99f' }],
	days: [{ x: 0, w: 40, label: '5', month: 'Oct' }, { x: 40, w: 40, label: '6', month: null }],
	offDays: [{ x: 160, w: 8, holiday: false }],
	gaps: [{ x: 176, w: 16 }],
	groups: [{ y: 0, h: 22, label: 'JHS' }],
	lanes: [{ y: 22, h: 40, label: 'G9', sublabel: 'Grade 9' }],
	bodyH: 62,
	bars: [{ x: 3, y: 26, w: 154, h: 32, label: 'Image Review', category: 'review', status: 'in_progress' }],
	gates: [],
	arrows: [],
	colors: { background: '#fff', foreground: '#111', danger: '#e00' },
	...over
});

describe('swimlaneSvg', () => {
	it('is sized to the label column, timeline, title band, axis and lanes', () => {
		expect(swimlaneSize(model())).toEqual({ width: 560, height: 56 + 26 + 28 + 62 });
		expect(swimlaneSvg(model())).toMatch(/^<svg [^>]*width="560" height="172"/);
	});

	it('draws the title, lane labels, window labels and bar labels', () => {
		const svg = swimlaneSvg(model());
		for (const s of ['eSTEAM L2', 'G9', 'Grade 9', 'JHS', 'Oct 5 to 8', 'Image Review', 'OCT']) expect(svg).toContain(`>${s}<`);
	});

	it('escapes text from the plan', () => {
		const svg = swimlaneSvg(model({ title: 'Books <A & B>', bars: [{ x: 3, y: 26, w: 300, h: 32, label: '"Q&A" pass', category: 'review', status: 'done' }] }));
		expect(svg).toContain('Books &lt;A &amp; B&gt;');
		expect(svg).toContain('&quot;Q&amp;A&quot; pass');
		expect(svg).not.toContain('<A & B>');
	});

	it('shows each status as on screen', () => {
		const bar = (status: string) => swimlaneSvg(model({ bars: [{ x: 3, y: 26, w: 154, h: 32, label: 'X', category: 'review', status }] }));
		expect(bar('not_started')).toContain('fill="none" stroke=');
		expect(bar('in_review')).toContain('url(#review)');
		expect(bar('returned')).toContain('stroke-dasharray="5 3"');
		expect(bar('done')).toMatch(/opacity="0.45".*✓/s);
		expect(bar('blocked')).toContain('stroke="#e00"');
	});

	it('draws gates as diamonds, outlined when on the critical path', () => {
		const svg = swimlaneSvg(model({ gates: [{ cx: 20, cy: 42 }, { cx: 100, cy: 42, critical: true }] }));
		expect(svg.match(/<polygon /g)).toHaveLength(3);
		// Centre: x 160 + 20; y 56 (title) + 54 (axis) + 42. Half diagonal 12.7.
		expect(svg).toContain(`points="180,139.3 192.7,152 180,164.7 167.3,152"`);
	});

	it('draws dependency arrows with their arrowheads', () => {
		const svg = swimlaneSvg(model({ arrows: [{ d: 'M 0 0 C 1 1 2 2 3 3', violated: false }, { d: 'M 5 5 V 9', violated: true }] }));
		expect(svg).toContain('marker-end="url(#ah)"');
		expect(svg).toContain('marker-end="url(#ah-v)"');
	});
});

describe('fitText', () => {
	const measure = (t: string) => t.length * 10;
	it('keeps text that fits and cuts text that does not', () => {
		expect(fitText('Review', 60, '', measure)).toBe('Review');
		expect(fitText('Overall Review', 60, '', measure)).toBe('Overa…');
		expect(fitText('Overall Review', 5, '', measure)).toBe('');
	});
});

describe('escapeXml', () => {
	it('escapes the five XML characters', () => {
		expect(escapeXml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;');
	});
});
