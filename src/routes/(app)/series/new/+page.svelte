<script lang="ts">
	import type { PageProps } from './$types';
	import { goto, invalidateAll } from '$app/navigation';
	import { api } from '#lib/api-client.ts';

	let { data }: PageProps = $props();

	let form = $state({ name: '', startDate: '', targetDate: '', hardLimitDate: '', status: 'planning' as 'planning' | 'active' });
	let templateId = $state('');
	let busy = $state(false);
	let message = $state<string | null>(null);

	// Start from the template picked on /templates, or the newest one.
	$effect.pre(() => {
		templateId = data.selected;
		if (!form.startDate) form.startDate = data.today;
	});

	const chosen = $derived(data.templates.find((t) => t.id === templateId) ?? null);
	// The chosen template's stages grouped by track, in pipeline order.
	const byTrack = $derived(
		chosen ? chosen.definition.tracks.map((tr) => ({ ...tr, stages: chosen.definition.stages.filter((s) => s.trackKeys.includes(tr.key)) })) : []
	);

	async function create(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		message = null;
		const res = await api<{ id: string }>('POST', '/api/series', { ...form, hardLimitDate: form.hardLimitDate || null, templateId: templateId || null });
		busy = false;
		if (!res.ok) {
			message = res.message;
			return;
		}
		await invalidateAll();
		await goto(`/s/${res.data.id}/settings`);
	}
</script>

<div class="new-page">
	<header>
		<h1>{data.first ? 'Create your first series' : 'New series'}</h1>
		<p class="sub">A series is one production run with its own pipeline, team and dates. Start from a saved template to copy its tracks, stages, dependency pattern, team labels and settings, or from a blank pipeline.</p>
	</header>

	{#if message}<p class="notice notice--error" role="alert">{message}</p>{/if}

	<form onsubmit={create} class="form">
		<section class="card">
			<h2>Basics</h2>
			<label class="field">
				<span>Name</span>
				<!-- svelte-ignore a11y_autofocus -->
				<input class="input" bind:value={form.name} required maxlength="120" placeholder="eSTEAM L3" autofocus />
			</label>
			<div class="row">
				<label class="field">
					<span>Start date</span>
					<input class="input" type="date" bind:value={form.startDate} required />
				</label>
				<label class="field">
					<span>Target date <span class="hint">binding finished by</span></span>
					<input class="input" type="date" bind:value={form.targetDate} required min={form.startDate} />
				</label>
				<label class="field">
					<span>Hard limit <span class="hint">optional</span></span>
					<input class="input" type="date" bind:value={form.hardLimitDate} min={form.targetDate || form.startDate} />
				</label>
			</div>
			<fieldset class="status">
				<legend>Status</legend>
				<label><input type="radio" bind:group={form.status} value="planning" /> Planning <span class="hint">set up books and windows first</span></label>
				<label><input type="radio" bind:group={form.status} value="active" /> Active</label>
			</fieldset>
		</section>

		<section class="card">
			<h2>Pipeline</h2>
			<div class="choices" role="radiogroup" aria-label="Start from">
				{#each data.templates as t (t.id)}
					<label class="choice" class:on={templateId === t.id}>
						<input type="radio" bind:group={templateId} value={t.id} />
						<span class="c-name">{t.name}</span>
						<span class="c-meta">{t.definition.stages.length} stages · {t.definition.tracks.length} {t.definition.tracks.length === 1 ? 'track' : 'tracks'}</span>
						{#if t.description}<span class="c-desc">{t.description}</span>{/if}
					</label>
				{/each}
				<label class="choice" class:on={templateId === ''}>
					<input type="radio" bind:group={templateId} value="" />
					<span class="c-name">Blank pipeline</span>
					<span class="c-meta">One track, no stages</span>
					<span class="c-desc">Build the pipeline in the series settings.</span>
				</label>
			</div>

			{#if chosen}
				<div class="preview">
					{#each byTrack as tr (tr.key)}
						<div class="track">
							<h3>{tr.name}</h3>
							<ol>
								{#each tr.stages as s (s.key)}
									<li data-cat={s.category}>{s.name} <span class="days">{s.defaultDays}d</span></li>
								{/each}
							</ol>
						</div>
					{/each}
					<p class="hint">
						{chosen.definition.links.length} dependency links ·
						{chosen.definition.settings.enforceWindows ? 'windows enforced' : 'windows not enforced'} ·
						{chosen.definition.settings.defaultCopies} copies per book{chosen.definition.teamLabels.length ? ` · teams: ${chosen.definition.teamLabels.join(', ')}` : ''}
					</p>
				</div>
			{:else if data.templates.length === 0}
				<p class="hint">No templates yet. An admin or coordinator can save one from any series' settings.</p>
			{/if}
		</section>

		<div class="foot">
			<button class="btn btn-primary btn-lg" disabled={busy}>{busy ? 'Creating…' : 'Create series'}</button>
			<span class="hint">Next you'll add books, windows and the team in the series settings.</span>
		</div>
	</form>
</div>

<style>
	.new-page { padding: var(--sp-6); max-width: 860px; }
	h1 { font-size: 22px; font-weight: 700; }
	.sub { font-size: 13px; color: var(--muted-foreground); margin: var(--sp-1) 0 var(--sp-4); max-width: 620px; }
	.form { display: flex; flex-direction: column; gap: var(--sp-4); }
	.card { border: 1px solid var(--border); border-radius: var(--radius); padding: var(--sp-4) var(--sp-5); display: flex; flex-direction: column; gap: var(--sp-3); }
	.card h2 { font-size: 15px; font-weight: 700; }
	.row { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--sp-3); }
	.hint { font-size: 12px; color: var(--muted-foreground); font-weight: 400; }
	.status { border: none; padding: 0; margin: 0; display: flex; gap: var(--sp-5); flex-wrap: wrap; font-size: 13px; }
	.status legend { font-weight: 500; margin-bottom: var(--sp-1); }
	.status label { display: inline-flex; align-items: center; gap: var(--sp-2); }

	.choices { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: var(--sp-2); }
	.choice { position: relative; display: flex; flex-direction: column; gap: 2px; border: 1px solid var(--border); border-radius: var(--radius); padding: var(--sp-3); cursor: pointer; }
	.choice input { position: absolute; opacity: 0; pointer-events: none; }
	.choice.on { border-color: var(--primary); background: var(--primary-subtle); }
	.choice:focus-within { outline: 2px solid var(--focus-ring); outline-offset: 1px; }
	.c-name { font-weight: 600; font-size: 14px; }
	.c-meta { font-size: 12px; color: var(--muted-foreground); }
	.c-desc { font-size: 12px; margin-top: var(--sp-1); }

	.preview { display: flex; flex-direction: column; gap: var(--sp-3); border-top: 1px solid var(--muted); padding-top: var(--sp-3); }
	.track h3 { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted-foreground); margin-bottom: var(--sp-1); }
	.track ol { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: var(--sp-1); }
	.track li { font-size: 12px; padding: 2px 8px; border-radius: 4px; background: var(--muted); }
	.track li[data-cat='review'] { background: var(--secondary-subtle); color: var(--secondary-foreground); }
	.track li[data-cat='gate'] { background: var(--tertiary-subtle); color: var(--tertiary-foreground); }
	.track li[data-cat='production'] { background: var(--production-subtle); }
	.track li[data-cat='publish'] { background: var(--publish-subtle); }
	.days { opacity: 0.7; font-variant-numeric: tabular-nums; }
	.foot { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap; }
</style>
