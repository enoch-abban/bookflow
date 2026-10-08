<script lang="ts">
	import type { PageProps } from './$types';
	import { invalidateAll } from '$app/navigation';
	import { api } from '#lib/api-client.ts';

	let { data }: PageProps = $props();
	type T = (typeof data.templates)[number];

	let notice = $state<{ kind: 'error' | 'ok'; text: string } | null>(null);
	let busy = $state(false);
	let editing = $state<{ id: string; name: string; description: string } | null>(null);
	let confirmDelete = $state<string | null>(null);
	let save = $state({ seriesId: '', name: '', description: '' });
	$effect.pre(() => {
		if (!save.seriesId) save.seriesId = data.seriesId ?? '';
	});

	const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
	const tracksOf = (t: T) => t.definition?.tracks.map((tr) => ({ ...tr, stages: t.definition!.stages.filter((s) => s.trackKeys.includes(tr.key)) })) ?? [];

	async function run<R>(p: Promise<import('#lib/api-client.ts').ApiResult<R>>, ok: (r: R) => string) {
		busy = true;
		notice = null;
		const res = await p;
		busy = false;
		if (!res.ok) {
			notice = { kind: 'error', text: res.message };
			return false;
		}
		notice = { kind: 'ok', text: ok(res.data) };
		await invalidateAll();
		return true;
	}

	async function saveFromSeries(e: SubmitEvent) {
		e.preventDefault();
		const done = await run(
			api<{ name: string; stages: number }>('POST', `/api/series/${save.seriesId}/template`, { name: save.name, description: save.description || null }),
			(r) => `Saved ${r.name} with ${r.stages} stages.`
		);
		if (done) save = { ...save, name: '', description: '' };
	}

	async function saveEdit(e: SubmitEvent) {
		e.preventDefault();
		if (!editing) return;
		const { id, name, description } = editing;
		if (await run(api('PATCH', `/api/templates/${id}`, { name, description: description || null }), () => `Saved ${name}.`)) editing = null;
	}

	async function remove(t: T) {
		if (await run(api('DELETE', `/api/templates/${t.id}`), () => `Deleted ${t.name}.`)) confirmDelete = null;
	}
</script>

<div class="tpl-page">
	<header>
		<h1>Templates</h1>
		<p class="sub">Saved pipelines that a new series can start from: tracks, stages with their default durations, the dependency pattern, team labels and settings. Windows are not saved, since their dates belong to one run.</p>
	</header>

	{#if notice}<p class="notice notice--{notice.kind}" role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p>{/if}

	{#if data.templates.length === 0}
		<p class="empty">No templates yet. Save one from a series below.</p>
	{/if}

	<ul class="list">
		{#each data.templates as t (t.id)}
			<li class="card">
				{#if editing?.id === t.id}
					<form class="edit" onsubmit={saveEdit}>
						<label class="field"><span>Name</span><input class="input" bind:value={editing.name} required maxlength="80" /></label>
						<label class="field"><span>Description</span><textarea class="input" bind:value={editing.description} maxlength="500" rows="2"></textarea></label>
						<div class="actions">
							<button class="btn btn-primary" disabled={busy}>Save</button>
							<button type="button" class="btn btn-ghost" onclick={() => (editing = null)}>Cancel</button>
						</div>
					</form>
				{:else}
					<div class="head">
						<div>
							<h2>{t.name}</h2>
							<p class="meta">
								Saved {fmt(t.createdAt)}{t.createdBy ? ` by ${t.createdBy}` : ''}
								{#if t.definition}· {t.definition.stages.length} stages · {t.definition.links.length} links{/if}
								{#if t.usedBy.length}· used by {t.usedBy.join(', ')}{/if}
							</p>
							{#if t.description}<p class="desc">{t.description}</p>{/if}
						</div>
						<div class="actions">
							{#if t.usable}<a class="btn btn-primary" href="/series/new?template={t.id}">Start a series</a>{/if}
							<button class="btn btn-ghost" onclick={() => (editing = { id: t.id, name: t.name, description: t.description ?? '' })}>Rename</button>
							{#if confirmDelete === t.id}
								<button class="btn btn-danger" disabled={busy} onclick={() => remove(t)}>Delete {t.name}</button>
								<button class="btn btn-ghost" onclick={() => (confirmDelete = null)}>Keep</button>
							{:else}
								<button class="btn btn-danger" onclick={() => (confirmDelete = t.id)}>Delete</button>
							{/if}
						</div>
					</div>
					{#if confirmDelete === t.id}
						<p class="hint">Series made from this template keep their own copy of its pipeline.</p>
					{/if}
					{#if !t.usable}
						<p class="notice notice--error">This template's saved definition is damaged and cannot be used.</p>
					{:else}
						<details>
							<summary>Pipeline</summary>
							<div class="tracks">
								{#each tracksOf(t) as tr (tr.key)}
									<div>
										<h3>{tr.name}</h3>
										<ol>
											{#each tr.stages as s (s.key)}<li data-cat={s.category}>{s.name} <span class="days">{s.defaultDays}d</span></li>{/each}
										</ol>
									</div>
								{/each}
							</div>
							{#if t.definition?.teamLabels.length}<p class="hint">Teams: {t.definition.teamLabels.join(', ')}</p>{/if}
						</details>
					{/if}
				{/if}
			</li>
		{/each}
	</ul>

	{#if data.seriesList.length}
		<section class="card save">
			<h2>Save a template from a series</h2>
			<form onsubmit={saveFromSeries} class="save-form">
				<label class="field">
					<span>Series</span>
					<select class="input" bind:value={save.seriesId} required>
						{#each data.seriesList as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
					</select>
				</label>
				<label class="field"><span>Template name</span><input class="input" bind:value={save.name} required maxlength="80" placeholder="Learner book series" /></label>
				<label class="field wide"><span>Description <span class="hint">optional</span></span><input class="input" bind:value={save.description} maxlength="500" /></label>
				<div><button class="btn btn-primary" disabled={busy}>Save template</button></div>
			</form>
		</section>
	{/if}
</div>

<style>
	.tpl-page { padding: var(--sp-6); max-width: 900px; display: flex; flex-direction: column; gap: var(--sp-4); }
	h1 { font-size: 22px; font-weight: 700; }
	.sub { font-size: 13px; color: var(--muted-foreground); margin-top: var(--sp-1); max-width: 640px; }
	.empty { padding: var(--sp-6); text-align: center; color: var(--muted-foreground); background: var(--muted); border-radius: var(--radius); }
	.hint { font-size: 12px; color: var(--muted-foreground); font-weight: 400; }
	.list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--sp-3); }
	.card { border: 1px solid var(--border); border-radius: var(--radius); padding: var(--sp-4) var(--sp-5); display: flex; flex-direction: column; gap: var(--sp-2); }
	.card h2 { font-size: 16px; font-weight: 700; }
	.head { display: flex; justify-content: space-between; gap: var(--sp-4); flex-wrap: wrap; }
	.meta { font-size: 12px; color: var(--muted-foreground); }
	.desc { font-size: 13px; margin-top: var(--sp-1); }
	.actions { display: flex; gap: var(--sp-2); align-items: flex-start; flex-wrap: wrap; }
	.edit { display: flex; flex-direction: column; gap: var(--sp-2); }
	details summary { cursor: pointer; font-size: 13px; color: var(--primary); }
	.tracks { display: flex; flex-direction: column; gap: var(--sp-2); margin-top: var(--sp-2); }
	.tracks h3 { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted-foreground); margin-bottom: var(--sp-1); }
	.tracks ol { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: var(--sp-1); }
	.tracks li { font-size: 12px; padding: 2px 8px; border-radius: 4px; background: var(--muted); }
	.tracks li[data-cat='review'] { background: var(--secondary-subtle); color: var(--secondary-foreground); }
	.tracks li[data-cat='gate'] { background: var(--tertiary-subtle); color: var(--tertiary-foreground); }
	.tracks li[data-cat='production'] { background: var(--production-subtle); }
	.tracks li[data-cat='publish'] { background: var(--publish-subtle); }
	.days { opacity: 0.7; }
	.save-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--sp-3); align-items: end; }
	.save-form .wide { grid-column: 1 / -1; }
</style>
