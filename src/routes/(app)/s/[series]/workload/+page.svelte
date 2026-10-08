<script lang="ts">
	import type { PageProps } from './$types';
	import { statusLabel } from '#lib/status.ts';

	let { data }: PageProps = $props();
	let picked = $state<{ personId: string; date: string } | null>(null);

	const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	const fmt = (d: string) => `${MONTHS[+d.slice(5, 7)]} ${+d.slice(8)}`;
	const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
	const dow = (d: string) => DOW[new Date(d + 'T12:00:00Z').getUTCDay()];


	// Week headers: runs of days sharing a Monday, labelled by that Monday.
	function mondayOf(d: string) {
		const t = Date.parse(d + 'T12:00:00Z');
		const back = (new Date(t).getUTCDay() + 6) % 7;
		return new Date(t - back * 86400000).toISOString().slice(0, 10);
	}
	const weeks = $derived(
		data.days.reduce<{ monday: string; span: number }[]>((acc, d) => {
			const m = mondayOf(d);
			if (acc.at(-1)?.monday === m) acc.at(-1)!.span++;
			else acc.push({ monday: m, span: 1 });
			return acc;
		}, [])
	);

	const groups = $derived(
		data.rows.reduce<{ team: string; rows: typeof data.rows }[]>((acc, r) => {
			if (acc.at(-1)?.team === r.team) acc.at(-1)!.rows.push(r);
			else acc.push({ team: r.team, rows: [r] });
			return acc;
		}, [])
	);

	const overloaded = $derived(data.rows.filter((r) => r.over > 0).length);

	const detail = $derived.by(() => {
		if (!picked) return null;
		const row = data.rows.find((r) => r.personId === picked!.personId);
		const cell = row?.cells[picked.date];
		if (!row || !cell) return null;
		return { row, date: picked.date, load: cell.load, tasks: cell.taskIds.map((id) => ({ id, ...data.taskInfo[id] })) };
	});

	function level(load: number, capacity: number) {
		if (load > capacity) return 'over';
		if (load === capacity) return 'full';
		return 'part';
	}

	function link(params: { from?: string; done?: boolean }) {
		return `?from=${params.from ?? data.from}${(params.done ?? data.includeDone) ? '&done=1' : ''}`;
	}
</script>

<div class="wl-page">
	<header class="wl-header">
		<div>
			<h1>Workload</h1>
			<p class="sub">
				Task days per person per working day, against each person's capacity.
				{#if overloaded}<strong class="over-text">{overloaded} {overloaded === 1 ? 'person is' : 'people are'} over capacity in this range.</strong>{/if}
			</p>
		</div>
		<nav class="range" aria-label="Date range">
			<a class="btn btn-ghost" href={link({ from: data.prev })} data-sveltekit-reset="false">← Earlier</a>
			<span class="range-label">{fmt(data.days[0] ?? data.from)} – {fmt(data.days.at(-1) ?? data.from)}</span>
			<a class="btn btn-ghost" href={link({ from: data.next })} data-sveltekit-reset="false">Later →</a>
			<a class="btn btn-ghost" href={link({ from: data.today })} data-sveltekit-reset="false">This week</a>
		</nav>
	</header>

	<div class="toolbar">
		<a class="toggle" href={link({ done: !data.includeDone })} data-sveltekit-reset="false">
			<span class="box" aria-hidden="true">{data.includeDone ? '✓' : ''}</span> Include finished tasks
		</a>
		<span class="legend">
			<span class="key" data-level="part"></span> Under capacity
			<span class="key" data-level="full"></span> At capacity
			<span class="key" data-level="over">!</span> Over capacity
		</span>
		{#if data.unscheduled}
			<span class="muted">{data.unscheduled} assigned {data.unscheduled === 1 ? 'task is' : 'tasks are'} unscheduled and not shown.</span>
		{/if}
	</div>

	{#if data.rows.length === 0}
		<p class="empty">This series has no members yet.</p>
	{:else}
		<div class="grid-wrap" data-tour="workload-grid">
			<table class="grid">
				<thead>
					<tr>
						<th class="person-col" rowspan="2" scope="col">Person</th>
						{#each weeks as w (w.monday)}<th class="week" colspan={w.span} scope="colgroup">Week of {fmt(w.monday)}</th>{/each}
					</tr>
					<tr>
						{#each data.days as d (d)}
							<th class="day" class:today={d === data.today} scope="col" title={d}>{dow(d)}<br />{+d.slice(8)}</th>
						{/each}
					</tr>
				</thead>
				{#each groups as g (g.team)}
					<tbody>
						<tr class="team-row"><th colspan={data.days.length + 1} scope="rowgroup">{g.team}</th></tr>
						{#each g.rows as r (r.personId)}
							<tr>
								<th class="person-col" scope="row">
									<span class="name">{r.name}</span>
									<span class="stats">
										{[r.capacity !== 1 ? `cap ${r.capacity}` : '', `peak ${r.peak}`].filter(Boolean).join(' · ')}{#if r.over}&nbsp;· <span class="over-text">{r.over} over</span>{/if}
									</span>
								</th>
								{#each data.days as d (d)}
									{@const c = r.cells[d]}
									<td class:today={d === data.today}>
										{#if c}
											{@const lv = level(c.load, r.capacity)}
											<button
												class="cell"
												data-level={lv}
												class:picked={picked?.personId === r.personId && picked?.date === d}
												aria-label="{r.name}, {fmt(d)}: {c.load} task {c.load === 1 ? 'day' : 'days'}{lv === 'over' ? ', over capacity' : ''}"
												onclick={() => (picked = picked?.personId === r.personId && picked?.date === d ? null : { personId: r.personId, date: d })}
											>{c.load}{lv === 'over' ? '!' : ''}</button>
										{/if}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				{/each}
			</table>
		</div>
	{/if}

	{#if detail}
		<section class="detail" aria-live="polite">
			<header>
				<h2>{detail.row.name} · {fmt(detail.date)}</h2>
				<span class:over-text={detail.load > detail.row.capacity}>{detail.load} of {detail.row.capacity} task {detail.row.capacity === 1 ? 'day' : 'days'}</span>
				<button class="btn btn-ghost" onclick={() => (picked = null)}>Close</button>
			</header>
			<ul>
				{#each detail.tasks as t (t.id)}
					<li>
						<a href="/s/{data.series.id}/books/{encodeURIComponent(t.book)}" class="t-book">{t.book}</a>
						<span class="t-stage">{t.stage}</span>
						<span class="t-dates">{fmt(t.startDate)}{t.endDate !== t.startDate ? ` – ${fmt(t.endDate)}` : ''}</span>
						<span class="chip chip--inline" data-status={t.status}>{statusLabel(t.status)}</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>

<style>
	.wl-page { padding: var(--sp-6); }
	.wl-header { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--sp-4); flex-wrap: wrap; margin-bottom: var(--sp-4); }
	.wl-header h1 { font-size: 22px; font-weight: 700; }
	.sub { font-size: 13px; color: var(--muted-foreground); margin-top: var(--sp-1); }
	.over-text { color: var(--danger); font-weight: 600; }
	.range { display: flex; align-items: center; gap: var(--sp-2); }
	.range-label { font-size: 13px; font-weight: 600; min-width: 120px; text-align: center; }

	.toolbar { display: flex; align-items: center; gap: var(--sp-5); flex-wrap: wrap; font-size: 12px; margin-bottom: var(--sp-3); }
	.toggle { display: inline-flex; align-items: center; gap: var(--sp-2); color: var(--foreground); }
	.box { width: 14px; height: 14px; border: 1px solid var(--border); border-radius: 3px; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; }
	.legend { display: inline-flex; align-items: center; gap: var(--sp-2); color: var(--muted-foreground); }
	.key { width: 16px; height: 14px; border-radius: 3px; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; margin-left: var(--sp-2); }
	.muted { color: var(--muted-foreground); }
	.empty { padding: var(--sp-8); text-align: center; color: var(--muted-foreground); background: var(--muted); border-radius: var(--radius); }

	.grid-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius); }
	.grid { border-collapse: separate; border-spacing: 0; font-size: 11px; }
	.grid th, .grid td { padding: 0; }
	.person-col {
		position: sticky; left: 0; z-index: 1; background: var(--background);
		min-width: 180px; max-width: 180px; text-align: left; padding: var(--sp-1) var(--sp-3) !important;
		border-right: 1px solid var(--border);
	}
	.person-col .name { display: block; font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.person-col .stats { display: block; font-size: 11px; font-weight: 400; color: var(--muted-foreground); }
	thead th { background: var(--muted); color: var(--muted-foreground); font-weight: 600; }
	thead .person-col { background: var(--muted); }
	.week { text-align: left; padding: var(--sp-1) var(--sp-2) !important; border-left: 1px solid var(--border); white-space: nowrap; }
	.day { width: 28px; min-width: 28px; text-align: center; font-weight: 500; line-height: 1.2; padding: 2px 0 !important; }
	.day.today { color: var(--primary); font-weight: 700; }
	.team-row th {
		text-align: left; padding: var(--sp-2) var(--sp-3) var(--sp-1) !important; font-size: 11px; font-weight: 700;
		text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted-foreground); border-top: 1px solid var(--border);
	}
	td { height: 34px; text-align: center; border-top: 1px solid var(--muted); }
	td.today { background: var(--primary-subtle); }

	.cell, .key {
		background: var(--muted);
	}
	.cell {
		width: 24px; height: 24px; border-radius: 4px; border: 1px solid transparent;
		font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; cursor: pointer; color: var(--foreground);
	}
	.cell[data-level="part"], .key[data-level="part"] { background: var(--primary-subtle); color: var(--primary-subtle-foreground); }
	.cell[data-level="full"], .key[data-level="full"] { background: var(--primary); color: var(--primary-foreground); }
	.cell[data-level="over"], .key[data-level="over"] { background: var(--danger); color: var(--background); }
	.cell:hover { filter: brightness(0.92); }
	.cell.picked { outline: 2px solid var(--foreground); outline-offset: 1px; }
	.cell:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 1px; }

	.detail { margin-top: var(--sp-4); border: 1px solid var(--border); border-radius: var(--radius); padding: var(--sp-3) var(--sp-4); max-width: 720px; }
	.detail header { display: flex; align-items: center; gap: var(--sp-3); margin-bottom: var(--sp-2); font-size: 13px; }
	.detail h2 { font-size: 15px; font-weight: 700; margin-right: auto; }
	.detail ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--sp-1); }
	.detail li { display: flex; align-items: center; gap: var(--sp-3); font-size: 13px; padding: var(--sp-1) 0; border-top: 1px solid var(--muted); }
	.t-book { font-weight: 700; color: var(--primary); }
	.t-stage { flex: 1; }
	.t-dates { color: var(--muted-foreground); font-size: 12px; }
	.chip--inline { padding: 1px 6px; border-radius: 4px; font-size: 11px; font-weight: 500; min-height: auto; }
</style>
