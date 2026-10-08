<script lang="ts">
	import type { PageProps } from './$types';
	import { goto, invalidateAll } from '$app/navigation';
	import { api } from '#lib/api-client.ts';

	let { data }: PageProps = $props();
	let busy = $state<string | null>(null);
	let notice = $state<{ kind: 'error' | 'ok'; text: string } | null>(null);

	const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	const day = (iso: string) => {
		const d = new Date(iso);
		return `${d.toLocaleDateString(undefined, { weekday: 'long' })} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
	};
	const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	const when = (iso: string) => `${new Date(iso).getDate()} ${MONTHS[new Date(iso).getMonth()]}, ${time(iso)}`;

	// Items grouped under a heading per local day.
	const days = $derived(
		data.items.reduce<{ day: string; items: typeof data.items }[]>((acc, it) => {
			const d = day(it.at);
			if (acc.at(-1)?.day === d) acc.at(-1)!.items.push(it);
			else acc.push({ day: d, items: [it] });
			return acc;
		}, [])
	);

	function filter(who: string) {
		goto(who ? `?who=${encodeURIComponent(who)}` : '?');
	}

	async function step(item: (typeof data.items)[number], which: 'undo' | 'redo') {
		busy = item.key;
		notice = null;
		const res = await api('POST', `/api/${which}`, { batchId: item.batchId, seriesId: data.series.id });
		busy = null;
		const what = which === 'undo' ? item.headline : item.headline.replace(/^Undid: /, '');
		notice = res.ok ? { kind: 'ok', text: `${which === 'undo' ? 'Undone' : 'Redone'}: ${what}` } : { kind: 'error', text: res.message };
		await invalidateAll();
	}
</script>

<div class="act-page">
	<header class="page-header">
		<div>
			<h1>Activity</h1>
			<p class="sub">
				Every change on {data.series.name}, newest first. You can undo your own last {data.limit} schedule and pipeline changes{data.me.isAdmin ? '; as an admin you can undo anyone’s' : ''}, and redo what you undid.
			</p>
		</div>
		<label class="field who">
			<span>Show changes by</span>
			<select class="input" value={data.who} onchange={(e) => filter(e.currentTarget.value)}>
				<option value="">Everyone</option>
				<option value="me">Me</option>
				{#each data.actors.filter((a) => a.id !== data.me.personId) as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
			</select>
		</label>
	</header>

	{#if notice}<p class="notice notice--{notice.kind}" role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p>{/if}

	{#if data.items.length === 0}
		<p class="empty">{data.before ? 'No older changes.' : 'No changes yet.'}</p>
	{:else}
		{#each days as d (d.day)}
			<section>
				<h2 class="day">{d.day}</h2>
				<ol class="items">
					{#each d.items as it (it.key)}
						<li class="item" data-kind={it.kind} class:reversed={!!it.reversedBy}>
							<div class="item-main">
								<div class="item-head">
									{#if it.kind !== 'change'}<span class="tag tag--{it.kind}">{it.kind === 'undo' ? 'Undo' : 'Redo'}</span>{/if}
									<span class="headline">{it.headline}</span>
								</div>
								<div class="meta">
									<span>{it.actor}</span>
									<span>{time(it.at)}</span>
									{#if it.reversedBy}
										<span class="undone">{it.reversedBy.action === 'redo' ? 'Redone' : 'Undone'} by {it.reversedBy.actor}, {when(it.reversedBy.at)}</span>
									{/if}
								</div>
								{#if it.count > 1}
									<details>
										<summary>{it.count} changes</summary>
										<ul class="lines">
											{#each it.lines as line, i (i)}<li>{line}</li>{/each}
											{#if it.count > it.lines.length}<li class="muted">and {it.count - it.lines.length} more</li>{/if}
										</ul>
									</details>
								{/if}
							</div>
							<div class="item-actions">
								{#if it.canUndo}
									<button class="btn btn-ghost" onclick={() => step(it, 'undo')} disabled={busy !== null}>{busy === it.key ? 'Undoing…' : 'Undo'}</button>
								{:else if it.canRedo}
									<button class="btn btn-ghost" onclick={() => step(it, 'redo')} disabled={busy !== null}>{busy === it.key ? 'Redoing…' : 'Redo'}</button>
								{/if}
							</div>
						</li>
					{/each}
				</ol>
			</section>
		{/each}
	{/if}

	{#if data.cursor || data.before}
		<nav class="pager">
			{#if data.before}<a class="btn btn-ghost" href="?{data.who ? `who=${encodeURIComponent(data.who)}` : ''}">Newest</a>{/if}
			{#if data.cursor}<a class="btn btn-ghost" href="?{data.who ? `who=${encodeURIComponent(data.who)}&` : ''}before={data.cursor}">Older changes</a>{/if}
		</nav>
	{/if}
</div>

<style>
	.act-page { padding: var(--sp-6); max-width: 900px; }
	.page-header { display: flex; justify-content: space-between; align-items: flex-end; gap: var(--sp-4); flex-wrap: wrap; margin-bottom: var(--sp-4); }
	.page-header h1 { font-size: 22px; font-weight: 700; }
	.sub { font-size: 13px; color: var(--muted-foreground); margin-top: var(--sp-1); max-width: 560px; }
	.who .input { min-width: 180px; }
	.empty { padding: var(--sp-6); text-align: center; color: var(--muted-foreground); background: var(--muted); border-radius: var(--radius); }
	.muted { color: var(--muted-foreground); }

	.day { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted-foreground); margin: var(--sp-5) 0 var(--sp-2); }
	.items { list-style: none; padding: 0; margin: 0; border: 1px solid var(--border); border-radius: var(--radius); }
	.item { display: flex; gap: var(--sp-4); align-items: flex-start; justify-content: space-between; padding: var(--sp-3) var(--sp-4); }
	.item + .item { border-top: 1px solid var(--muted); }
	.item.reversed .headline { text-decoration: line-through; text-decoration-color: var(--muted-foreground); color: var(--muted-foreground); }
	.item-main { min-width: 0; flex: 1; }
	.item-head { display: flex; align-items: baseline; gap: var(--sp-2); }
	.headline { font-size: 14px; }
	.meta { display: flex; flex-wrap: wrap; gap: var(--sp-3); font-size: 12px; color: var(--muted-foreground); margin-top: 2px; }
	.undone { color: var(--tertiary-foreground); font-weight: 500; }
	.tag { font-size: 11px; font-weight: 700; padding: 1px 6px; border-radius: 4px; flex-shrink: 0; }
	.tag--undo { background: var(--tertiary-subtle); color: var(--tertiary-foreground); }
	.tag--redo { background: var(--secondary-subtle); color: var(--secondary-foreground); }

	details { margin-top: var(--sp-1); font-size: 13px; }
	summary { cursor: pointer; color: var(--primary); font-size: 12px; }
	.lines { margin: var(--sp-1) 0 0; padding-left: var(--sp-5); display: flex; flex-direction: column; gap: 2px; color: var(--foreground); }
	.item-actions { flex-shrink: 0; }

	.pager { display: flex; gap: var(--sp-2); justify-content: center; margin-top: var(--sp-5); }
</style>
