<script lang="ts">
	import { tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { Step, TourContext } from '#lib/tour/steps.ts';

	type Props = {
		steps: Step[];
		ctx: TourContext;
		open: boolean;
		/** Called when the tour ends, finished or skipped. */
		onend: (how: 'finished' | 'skipped') => void;
	};
	let { steps, ctx, open = $bindable(), onend }: Props = $props();

	const PAD = 6; // space around the highlighted element
	const GAP = 12; // between the highlight and the card
	const CARD_W = 340;

	let index = $state(0);
	let rect = $state<{ top: number; left: number; width: number; height: number } | null>(null);
	let card = $state<HTMLElement>();
	let cardH = $state(180);
	let nextBtn = $state<HTMLButtonElement>();
	let busy = $state(false);
	let target: Element | null = null;
	let run = 0; // guards against an older step finishing after a newer one started

	const step = $derived(steps[index]);
	const last = $derived(index === steps.length - 1);
	const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

	/** The highlight around the target, kept inside the window (big tables run off it). */
	function box(el: Element | null) {
		if (!el) return null;
		const r = el.getBoundingClientRect();
		const top = Math.max(4, r.top - PAD);
		const left = Math.max(4, r.left - PAD);
		const bottom = Math.min(window.innerHeight - 4, r.bottom + PAD);
		const right = Math.min(window.innerWidth - 4, r.right + PAD);
		return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
	}
	function measure() {
		rect = box(target);
	}

	async function waitFor(selector: string, ms = 4000): Promise<Element | null> {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			const el = document.querySelector(selector);
			// Present and laid out (a hidden element has no box to point at).
			if (el && el.getBoundingClientRect().width > 0) return el;
			await new Promise((r) => setTimeout(r, 100));
		}
		return null;
	}

	/** Open step i (its page first), moving on in `dir` past any whose element is missing. */
	async function show(i: number, dir: 1 | -1) {
		const mine = ++run;
		busy = true;
		while (i >= 0 && i < steps.length) {
			const st = steps[i];
			const path = st.path(ctx);
			if (path && page.url.pathname !== path) await goto(path);
			if (mine !== run) return;
			const el = st.target ? await waitFor(`[data-tour="${st.target}"]`) : null;
			if (mine !== run) return;
			if (st.target && !el) {
				i += dir;
				continue;
			}
			el?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
			await new Promise((r) => setTimeout(r, reduced() ? 0 : 350));
			if (mine !== run) return;
			// Card text and highlight change together, once the page has settled.
			index = i;
			target = el;
			measure();
			busy = false;
			await tick();
			nextBtn?.focus();
			return;
		}
		busy = false;
		end(i >= steps.length ? 'finished' : 'skipped');
	}

	function end(how: 'finished' | 'skipped') {
		run++;
		open = false;
		target = null;
		rect = null;
		onend(how);
	}

	// While a page opens the buttons ignore presses rather than disabling, so focus stays put.
	const next = () => !busy && (last ? end('finished') : show(index + 1, 1));
	const back = () => !busy && index > 0 && show(index - 1, -1);

	// Start from the first step each time the tour opens.
	let wasOpen = false;
	$effect(() => {
		if (open && !wasOpen) show(0, 1);
		wasOpen = open;
	});

	function onKey(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') { e.preventDefault(); end('skipped'); }
		else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
		else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
	}

	$effect(() => {
		if (card) cardH = card.offsetHeight;
	});

	// Scrolling inside any container (the swimlane, a table) moves the highlight with it.
	$effect(() => {
		if (!open) return;
		window.addEventListener('scroll', measure, true);
		return () => window.removeEventListener('scroll', measure, true);
	});

	// The card sits below the highlight, or above it when there is no room, kept on screen.
	const pos = $derived.by(() => {
		const vw = typeof window === 'undefined' ? 1200 : window.innerWidth;
		const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
		const w = Math.min(CARD_W, vw - 32);
		if (!rect) return { top: Math.max(16, vh / 2 - cardH / 2), left: vw / 2 - w / 2, w };
		// A target taller than half the window (a table, the timeline): the card sits in its lower corner.
		if (rect.height > vh / 2) return { top: vh - cardH - 24, left: vw - w - 24, w };
		const below = rect.top + rect.height + GAP;
		const top = below + cardH <= vh - 16 ? below : Math.max(16, rect.top - GAP - cardH);
		const left = Math.min(Math.max(16, rect.left), vw - w - 16);
		return { top: Math.min(top, vh - cardH - 16), left, w };
	});
</script>

<svelte:window onkeydown={onKey} onresize={measure} />

{#if open && step}
	<div class="tour-layer" class:dim={!rect}>
		{#if rect}
			<div class="spot" style:top="{rect.top}px" style:left="{rect.left}px" style:width="{rect.width}px" style:height="{rect.height}px"></div>
		{/if}
		<div
			bind:this={card}
			class="tour-card"
			role="dialog"
			aria-modal="true"
			aria-labelledby="tour-title"
			aria-describedby="tour-body"
			style:top="{pos.top}px"
			style:left="{pos.left}px"
			style:width="{pos.w}px"
		>
			<p class="count">{index + 1} of {steps.length}</p>
			<h2 id="tour-title">{step.title}</h2>
			<p id="tour-body">{step.body}</p>
			<div class="actions">
				<button class="btn btn-link skip" onclick={() => end('skipped')}>{last ? '' : 'Skip tour'}</button>
				<button class="btn btn-ghost" onclick={back} disabled={index === 0} aria-disabled={busy}>Back</button>
				<button class="btn btn-primary" bind:this={nextBtn} onclick={next} aria-disabled={busy}>{last ? 'Finish' : 'Next'}</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.tour-layer { position: fixed; inset: 0; z-index: 1000; }
	.tour-layer.dim { background: rgba(15, 23, 42, 0.55); }
	.spot {
		position: fixed;
		border-radius: var(--radius);
		box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.55);
		outline: 2px solid var(--primary);
		pointer-events: none;
		transition: top 0.25s ease, left 0.25s ease, width 0.25s ease, height 0.25s ease;
	}
	.tour-card {
		position: fixed;
		background: var(--background);
		color: var(--foreground);
		border-radius: var(--radius);
		box-shadow: 0 12px 32px rgba(15, 23, 42, 0.25);
		padding: var(--sp-4) var(--sp-5);
		display: flex; flex-direction: column; gap: var(--sp-2);
		transition: top 0.25s ease, left 0.25s ease;
	}
	.count { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted-foreground); margin: 0; }
	h2 { font-size: 16px; font-weight: 700; margin: 0; }
	#tour-body { font-size: 13px; line-height: 1.5; margin: 0; }
	.actions { display: flex; align-items: center; gap: var(--sp-2); margin-top: var(--sp-2); }
	.skip { margin-right: auto; color: var(--muted-foreground); }
	@media (prefers-reduced-motion: reduce) {
		.spot, .tour-card { transition: none; }
	}
</style>
