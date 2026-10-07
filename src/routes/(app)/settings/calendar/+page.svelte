<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { api } from '#lib/api-client.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	type Report = {
		moved: number; unscheduled: number; placed: number; rewindowed: number;
		outsideWindow: { id: string; label: string }[];
		projectedFinish: { before: string | null; after: string | null };
	};
	type Change = { holiday: { date: string; label: string }; weekend: boolean; series: { id: string; name: string; report: Report }[]; batchId?: string };
	type Call = { method: string; url: string; body: unknown; okText: string };

	let form = $state({ date: '', label: '' });
	let pending = $state<(Call & { change: Change }) | null>(null);
	let flash = $state<{ ok: boolean; text: string } | null>(null);
	let lastBatch = $state<string | null>(null);
	let busy = $state(false);

	const fmt = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
	const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
	const isWeekend = (iso: string) => [0, 6].includes(new Date(iso + 'T12:00:00Z').getUTCDay());

	function seriesSummary(r: Report) {
		const parts: string[] = [];
		if (r.moved) parts.push(plural(r.moved, 'task moves', 'tasks move'));
		if (r.unscheduled) parts.push(plural(r.unscheduled, 'becomes unscheduled', 'become unscheduled'));
		if (r.placed) parts.push(plural(r.placed, 'unscheduled task is placed', 'unscheduled tasks are placed'));
		if (r.outsideWindow.length) parts.push(plural(r.outsideWindow.length, 'started task is flagged Outside window', 'started tasks are flagged Outside window'));
		if (r.projectedFinish.after && r.projectedFinish.after !== r.projectedFinish.before) parts.push(`projected finish ${fmt(r.projectedFinish.after)}`);
		return parts.length ? parts.join(', ') : 'nothing moves';
	}

	async function ask(call: Call) {
		busy = true;
		flash = null;
		const res = await api<Change>(call.method, call.url, { ...(call.body as object), preview: true });
		busy = false;
		if (!res.ok) return (flash = { ok: false, text: res.message });
		pending = { ...call, change: res.data };
	}

	async function confirm() {
		if (!pending) return;
		const { method, url, body, okText } = pending;
		busy = true;
		const res = await api<Change>(method, url, body);
		busy = false;
		pending = null;
		if (!res.ok) return (flash = { ok: false, text: res.message });
		lastBatch = res.data.batchId ?? null;
		flash = { ok: true, text: okText };
		form = { date: '', label: '' };
		await invalidateAll();
	}

	async function undo() {
		if (!lastBatch) return;
		busy = true;
		const res = await api('POST', '/api/undo', { batchId: lastBatch, seriesId: '' });
		busy = false;
		lastBatch = null;
		flash = res.ok ? { ok: true, text: 'Undone.' } : { ok: false, text: res.message };
		if (res.ok) await invalidateAll();
	}

	function add(e: SubmitEvent) {
		e.preventDefault();
		ask({ method: 'POST', url: '/api/holidays', body: { date: form.date, label: form.label.trim() }, okText: `Added ${form.label.trim()}.` });
	}
</script>

<svelte:head><title>Calendar · bookflow</title></svelte:head>

<div class="calendar-page">
	<header>
		<h1>Calendar</h1>
		<p class="lede">
			Working days are Monday to Friday, minus these holidays. They apply to every series: adding or removing one re-plans
			tasks that have not started around it, keeping their length in working days. Started and Done tasks never move.
		</p>
	</header>

	{#if flash || lastBatch}
		<div class="foot">
			{#if flash}<p class="notice" class:notice--ok={flash.ok} class:notice--error={!flash.ok} role="status">{flash.text}</p>{/if}
			{#if lastBatch}<button class="btn btn-ghost btn-lg" disabled={busy} onclick={undo}>Undo</button>{/if}
		</div>
	{/if}

	{#if pending}
		{@const c = pending.change}
		<div class="impact" role="alertdialog" aria-label="Confirm holiday change">
			<p>
				<strong>{pending.method === 'POST' ? 'Add' : 'Remove'} {c.holiday.label}, {fmt(c.holiday.date)}.</strong>
				{#if c.weekend}It falls on a weekend, so no working day changes.{/if}
			</p>
			<ul>
				{#each c.series as s (s.id)}<li><strong>{s.name}:</strong> {seriesSummary(s.report)}.</li>{/each}
			</ul>
			<div class="foot">
				<button class="btn btn-ghost btn-lg" onclick={() => (pending = null)}>Cancel</button>
				<button class="btn btn-primary btn-lg" disabled={busy} onclick={confirm}>{pending.method === 'POST' ? 'Add holiday' : 'Remove holiday'}</button>
			</div>
		</div>
	{/if}

	<section class="card">
		<h2>Holidays</h2>
		<table>
			<tbody>
				{#each data.holidays as h (h.date)}
					<tr>
						<td class="date">{fmt(h.date)}</td>
						<td>{h.label}{#if isWeekend(h.date)}<span class="muted"> · weekend</span>{/if}</td>
						<td class="right">
							<button class="btn btn-danger" disabled={busy || !!pending}
								onclick={() => ask({ method: 'DELETE', url: `/api/holidays/${h.date}`, body: {}, okText: `Removed ${h.label}.` })}>Remove</button>
						</td>
					</tr>
				{:else}
					<tr><td class="empty">No holidays yet.</td></tr>
				{/each}
			</tbody>
		</table>

		<form class="add" onsubmit={add}>
			<label class="field">
				<span>Date</span>
				<input class="input" type="date" bind:value={form.date} required />
			</label>
			<label class="field grow">
				<span>Name</span>
				<input class="input" bind:value={form.label} maxlength="80" placeholder="e.g. Farmers' Day" required />
			</label>
			<button class="btn btn-primary btn-lg" disabled={busy || !!pending}>Preview</button>
		</form>
	</section>
</div>

<style>
	.calendar-page { max-width: 760px; margin: 0 auto; padding: var(--sp-6) var(--sp-4) var(--sp-8); display: flex; flex-direction: column; gap: var(--sp-4); }
	h1 { font-size: 22px; font-weight: 700; }
	.lede { margin: var(--sp-1) 0 0; color: var(--muted-foreground); font-size: 13px; }
	.card { border: 1px solid var(--border); border-radius: var(--radius); padding: var(--sp-4) var(--sp-5); display: flex; flex-direction: column; gap: var(--sp-3); }
	.card h2 { font-size: 15px; font-weight: 700; }
	table { width: 100%; border-collapse: collapse; font-size: 13px; }
	td { padding: var(--sp-2); border-bottom: 1px solid var(--border); }
	.date { white-space: nowrap; font-variant-numeric: tabular-nums; font-weight: 600; }
	.right { text-align: right; }
	.muted { color: var(--muted-foreground); }
	.empty { color: var(--muted-foreground); text-align: center; padding: var(--sp-5); }
	.add { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--sp-3); }
	.grow { flex: 1 1 200px; }
	.foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: var(--sp-3); }
	.foot .notice { margin: 0 auto 0 0; }
	.impact { border: 1px solid var(--tertiary); background: var(--tertiary-subtle); color: var(--tertiary-foreground); border-radius: var(--radius); padding: var(--sp-4); display: flex; flex-direction: column; gap: var(--sp-2); font-size: 13px; }
	.impact p, .impact ul { margin: 0; }
	.impact ul { padding-left: var(--sp-5); }
</style>
