<script lang="ts">
	import type { PageProps } from './$types';
	import { goto } from '$app/navigation';
	import { api } from '#lib/api-client.ts';

	let { data }: PageProps = $props();

	let name = $state('');
	let saving = $state(false);
	let message = $state<{ kind: 'error' | 'success'; text: string } | null>(null);
	let showAll = $state(false);

	const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	const fmt = (d: string | null) => (d ? `${MONTHS[+d.slice(5, 7)]} ${+d.slice(8)}` : '—');
	const fmtFull = (iso: string) => `${fmt(iso.slice(0, 10))}, ${iso.slice(0, 4)}`;
	const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
	const tone = (n: number | null) => (n === null ? '' : n > 0 ? 'late' : n < 0 ? 'early' : 'same');

	const visible = $derived(showAll ? data.rows : data.rows.filter((r) => r.variance !== 0 || !r.baseEnd));

	async function save(e: SubmitEvent) {
		e.preventDefault();
		saving = true;
		message = null;
		const res = await api<{ id: string; name: string; taskCount: number }>('POST', `/api/series/${data.series.id}/baselines`, { name: name || data.suggestedName });
		saving = false;
		if (!res.ok) {
			message = { kind: 'error', text: res.message };
			return;
		}
		name = '';
		message = { kind: 'success', text: `Saved ${res.data.name} with ${res.data.taskCount} tasks. Variance is now measured against it.` };
		await goto(`?b=${res.data.id}`, { invalidateAll: true });
	}
</script>

<div class="bl-page">
	<header class="page-header">
		<div>
			<h1>Baselines</h1>
			<p class="sub">Frozen copies of the plan's dates, to measure slippage against. The book pages and task drawer compare with the latest one.</p>
		</div>
		<form class="save" data-tour="baseline-save" onsubmit={save}>
			<label class="field">
				<span>Save the current plan as</span>
				<input class="input" bind:value={name} placeholder={data.suggestedName} maxlength="60" />
			</label>
			<button class="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save baseline'}</button>
		</form>
	</header>

	{#if message}<p class="notice notice--{message.kind === 'error' ? 'error' : 'ok'}" role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>{/if}

	{#if !data.selected}
		<p class="empty">No baselines yet. Save the current plan to start measuring slippage.</p>
	{:else}
		<div class="layout">
			<nav class="list" aria-label="Saved baselines">
				<h2 class="section-title">Saved</h2>
				<ul>
					{#each data.baselines as b, i (b.id)}
						<li>
							<a href="?b={b.id}" data-sveltekit-noscroll aria-current={b.id === data.selected.id ? 'true' : undefined}>
								<span class="b-name">{b.name}{#if i === 0}<span class="tag">Latest</span>{/if}</span>
								<span class="b-meta">{fmtFull(b.createdAt)} · {b.taskCount} tasks</span>
							</a>
						</li>
					{/each}
				</ul>
			</nav>

			<div class="compare">
				<h2 class="section-title">Current plan against {data.selected.name}</h2>
				<div class="cards">
					<div class="card">
						<span class="card-label">Projected finish</span>
						<span class="card-value">{fmt(data.summary.projected)}</span>
						<span class="card-note">
							{data.selected.name}: {fmt(data.summary.baseProjected)}
							{#if data.summary.finishVariance !== null}
								<span class="var" data-tone={tone(data.summary.finishVariance)}>{signed(data.summary.finishVariance)} days</span>
							{/if}
						</span>
					</div>
					<div class="card">
						<span class="card-label">Later than baseline</span>
						<span class="card-value" class:late-text={data.summary.later > 0}>{data.summary.later}</span>
						<span class="card-note">tasks; worst {signed(data.summary.worst)} days</span>
					</div>
					<div class="card">
						<span class="card-label">Earlier</span>
						<span class="card-value">{data.summary.earlier}</span>
						<span class="card-note">{data.summary.same} on their baseline date</span>
					</div>
					<div class="card">
						<span class="card-label">Not in baseline</span>
						<span class="card-value">{data.summary.added}</span>
						<span class="card-note">tasks added or unscheduled since</span>
					</div>
				</div>

				<h3 class="sub-title">Books</h3>
				<div class="table-wrap">
					<table>
						<thead><tr><th scope="col">Book</th><th scope="col">Baseline binding end</th><th scope="col">Planned binding end</th><th scope="col">Variance</th><th scope="col">Tasks later</th></tr></thead>
						<tbody>
							{#each data.books as b (b.code)}
								<tr>
									<th scope="row"><a href="/s/{data.series.id}/books/{encodeURIComponent(b.code)}">{b.code}</a> <span class="muted">{b.name}</span></th>
									<td>{fmt(b.baseFinish)}</td>
									<td>{fmt(b.finish)}</td>
									<td><span class="var" data-tone={tone(b.variance)}>{b.variance === null ? '—' : signed(b.variance)}</span></td>
									<td>{b.late || ''}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				<div class="tasks-head">
					<h3 class="sub-title">Tasks</h3>
					<label class="check"><input type="checkbox" bind:checked={showAll} /> Show tasks still on their baseline dates</label>
				</div>
				{#if visible.length === 0}
					<p class="empty">Every task is on its {data.selected.name} dates.</p>
				{:else}
					<div class="table-wrap">
						<table>
							<thead><tr><th scope="col">Book</th><th scope="col">Stage</th><th scope="col">Baseline</th><th scope="col">Planned</th><th scope="col">Variance</th></tr></thead>
							<tbody>
								{#each visible as r (r.id)}
									<tr>
										<th scope="row">{r.book}</th>
										<td>{r.stage}{#if r.status === 'done'} <span class="muted">(done)</span>{/if}</td>
										<td>{r.baseEnd ? `${fmt(r.baseStart)} – ${fmt(r.baseEnd)}` : 'Not in baseline'}</td>
										<td>{r.unscheduled ? 'Unscheduled' : `${fmt(r.startDate)} – ${fmt(r.endDate)}`}</td>
										<td><span class="var" data-tone={tone(r.variance)}>{r.variance === null ? '—' : signed(r.variance)}</span></td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.bl-page { padding: var(--sp-6); max-width: 1200px; }
	.page-header { display: flex; justify-content: space-between; align-items: flex-end; gap: var(--sp-4); flex-wrap: wrap; margin-bottom: var(--sp-4); }
	.page-header h1 { font-size: 22px; font-weight: 700; }
	.sub { font-size: 13px; color: var(--muted-foreground); margin-top: var(--sp-1); max-width: 560px; }
	.save { display: flex; align-items: flex-end; gap: var(--sp-2); }
	.save .input { width: 180px; }
	.empty { padding: var(--sp-6); text-align: center; color: var(--muted-foreground); background: var(--muted); border-radius: var(--radius); }
	.muted { color: var(--muted-foreground); font-weight: 400; }

	.layout { display: grid; grid-template-columns: 220px 1fr; gap: var(--sp-6); align-items: start; }
	@media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }
	.section-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted-foreground); margin-bottom: var(--sp-3); }
	.sub-title { font-size: 15px; font-weight: 700; margin: var(--sp-5) 0 var(--sp-2); }

	.list ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--sp-1); }
	.list a { display: flex; flex-direction: column; padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-sm); border: 1px solid transparent; color: var(--foreground); }
	.list a:hover { background: var(--muted); }
	.list a[aria-current] { border-color: var(--primary); background: var(--primary-subtle); }
	.b-name { font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: var(--sp-2); }
	.b-meta { font-size: 12px; color: var(--muted-foreground); }
	.tag { font-size: 10px; font-weight: 700; background: var(--secondary-subtle); color: var(--secondary-foreground); padding: 1px 5px; border-radius: 4px; }

	.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: var(--sp-3); }
	.card { border: 1px solid var(--border); border-radius: var(--radius); padding: var(--sp-3) var(--sp-4); display: flex; flex-direction: column; gap: 2px; }
	.card-label { font-size: 12px; color: var(--muted-foreground); }
	.card-value { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; }
	.card-note { font-size: 12px; color: var(--muted-foreground); display: flex; gap: var(--sp-2); flex-wrap: wrap; align-items: center; }
	.late-text { color: var(--danger); }

	.tasks-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-3); flex-wrap: wrap; }
	.check { font-size: 13px; display: inline-flex; align-items: center; gap: var(--sp-2); }

	.table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius); }
	table { width: 100%; border-collapse: collapse; font-size: 13px; }
	th, td { text-align: left; padding: var(--sp-2) var(--sp-3); border-top: 1px solid var(--muted); white-space: nowrap; }
	thead th { background: var(--muted); color: var(--muted-foreground); font-size: 12px; font-weight: 600; border-top: none; }
	tbody th { font-weight: 600; }
	tbody th a { color: var(--primary); }

	.var { font-weight: 700; font-variant-numeric: tabular-nums; padding: 1px 6px; border-radius: 4px; }
	.var[data-tone='late'] { background: var(--danger-subtle); color: var(--danger); }
	.var[data-tone='early'] { background: var(--success-subtle); color: var(--success); }
	.var[data-tone='same'] { color: var(--muted-foreground); }
</style>
