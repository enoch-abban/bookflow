<script lang="ts">
	import type { PageProps } from './$types';
	import { statusLabel } from '#lib/status.ts';
	import { openTask } from '#lib/task-drawer.svelte.ts';

	let { data }: PageProps = $props();

	// ── Filters (spec: Status matrix): book group, batch, person (or Unassigned), status ──
	let fGroup = $state('');
	let fBatch = $state('');
	let fPerson = $state('');
	let fStatus = $state('');
	const filtering = $derived(!!(fGroup || fBatch || fPerson || fStatus));
	const assigneesOf = $derived(
		data.assignees.reduce<Record<string, string[]>>((acc, a) => ((acc[a.taskId] ??= []).push(a.personId), acc), {})
	);
	const gateStages = $derived(new Set(data.stages.filter((s) => s.category === 'gate').map((s) => s.id)));
	const isUnassigned = (t: (typeof data.tasks)[0]) => !assigneesOf[t.id]?.length && !gateStages.has(t.stageId) && t.status !== 'done';
	/** Whether a task passes the person and status filters. */
	function matches(t: (typeof data.tasks)[0]) {
		if (fStatus && t.status !== fStatus) return false;
		if (fPerson === '__none') return isUnassigned(t);
		if (fPerson && !assigneesOf[t.id]?.includes(fPerson)) return false;
		return true;
	}
	const groupOptions = $derived([...new Set(data.books.map((b) => b.groupLabel ?? 'Other'))]);
	const batchOptions = $derived([...new Set(data.books.map((b) => b.batch).filter((x): x is number => x != null))].sort((a, b) => a - b));
	const statusOptions = ['not_started', 'in_progress', 'in_review', 'returned', 'blocked', 'done'];
	const peopleOptions = $derived([...data.people].sort((a, b) => a.displayName.localeCompare(b.displayName)));
	function clearFilters() {
		fGroup = fBatch = fPerson = fStatus = '';
	}

	// ── Derived lookup maps ───────────────────────────────────────────────────

	const stagesForTrack = $derived.by(() => {
		const m = new Map<string, Set<string>>(); // trackId → Set<stageId>
		for (const link of data.stageTrackLinks) {
			if (!m.has(link.trackId)) m.set(link.trackId, new Set());
			m.get(link.trackId)!.add(link.stageId);
		}
		return m;
	});

	const taskMap = $derived.by(() => {
		const m = new Map<string, (typeof data.tasks)[0]>(); // `bookId:stageId` → task
		for (const t of data.tasks) m.set(`${t.bookId}:${t.stageId}`, t);
		return m;
	});

	const leadMap = $derived.by(() => {
		const m = new Map<string, (typeof data.people)[0]>(); // taskId → lead person
		for (const a of data.assignees) {
			if (m.has(a.taskId) && !a.isLead) continue;
			const p = data.people.find((p) => p.id === a.personId);
			if (p) m.set(a.taskId, p);
		}
		return m;
	});

	const bookGroups = $derived.by(() => {
		const seen = new Map<string, (typeof data.books)[0][]>();
		for (const book of data.books) {
			const key = book.groupLabel ?? 'Other';
			if (fGroup && key !== fGroup) continue;
			if (fBatch && String(book.batch) !== fBatch) continue;
			// With a person or status filter, show only books with a matching task.
			if ((fPerson || fStatus) && !data.tasks.some((t) => t.bookId === book.id && stageApplies(book.trackId, t.stageId) && matches(t))) continue;
			if (!seen.has(key)) seen.set(key, []);
			seen.get(key)!.push(book);
		}
		return [...seen.entries()].map(([label, books]) => ({ label, books }));
	});

	// ── Helpers ───────────────────────────────────────────────────────────────

	function initials(name: string): string {
		return name
			.split(/\s+/)
			.map((w) => w[0])
			.join('')
			.toUpperCase()
			.slice(0, 2);
	}

	function fmtDate(d: string): string {
		const [, mm, dd] = d.split('-');
		return `${['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+mm]} ${+dd}`;
	}

	function fmtFull(d: string): string {
		const [yr, mm, dd] = d.split('-');
		return `${['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+mm]} ${+dd}, ${yr}`;
	}


	function stageApplies(trackId: string, stageId: string): boolean {
		return stagesForTrack.get(trackId)?.has(stageId) ?? false;
	}

	const projectedLabel = $derived(
		data.stats.projectedFinish ? fmtFull(data.stats.projectedFinish) : 'Unknown'
	);
	const targetLabel    = $derived(fmtFull(data.series.targetDate));
	const limitLabel     = $derived(data.series.hardLimitDate ? fmtFull(data.series.hardLimitDate) : null);
	const projectedLate  = $derived(
		!!data.stats.projectedFinish && data.stats.projectedFinish > data.series.targetDate
	);
</script>

<!-- ── Header strip ──────────────────────────────────────────────────────── -->
<div class="series-strip" data-tour="series-strip">
	<div class="strip-title">
		<h1 class="series-name">{data.series.name}</h1>
		<span class="strip-date">Today: {fmtFull(data.stats.today)}</span>
	</div>
	<div class="strip-meta">
		<span class="meta-item">
			Projected: <strong class:projected-late={projectedLate}>{projectedLabel}</strong>
		</span>
		<span class="meta-item">Target: <strong>{targetLabel}</strong></span>
		{#if limitLabel}
			<span class="meta-item">Limit: <strong>{limitLabel}</strong></span>
		{/if}
		{#if data.stats.late > 0}
			<span class="meta-badge badge-late">{data.stats.late} late</span>
		{/if}
		{#if data.stats.atRisk > 0}
			<span class="meta-badge badge-risk">{data.stats.atRisk} at risk</span>
		{/if}
		{#if data.stats.unassignedSoon > 0}
			<button class="meta-badge badge-unassigned" onclick={() => { clearFilters(); fPerson = '__none'; }} title="Unassigned tasks due to start within the next five working days">
				{data.stats.unassignedSoon} unassigned starting soon
			</button>
		{/if}
	</div>
</div>

{#if data.books.length}
	<div class="filters" data-tour="matrix-filters" role="group" aria-label="Filter the matrix">
		<label><span>{data.series.bookGroupLabel}</span>
			<select class="input" bind:value={fGroup}><option value="">All</option>{#each groupOptions as g (g)}<option value={g}>{g}</option>{/each}</select>
		</label>
		{#if batchOptions.length}
			<label><span>Batch</span>
				<select class="input" bind:value={fBatch}><option value="">All</option>{#each batchOptions as b (b)}<option value={String(b)}>Batch {b}</option>{/each}</select>
			</label>
		{/if}
		<label><span>Person</span>
			<select class="input" bind:value={fPerson}>
				<option value="">Everyone</option>
				<option value="__none">Unassigned</option>
				{#each peopleOptions as p (p.id)}<option value={p.id}>{p.displayName}</option>{/each}
			</select>
		</label>
		<label><span>Status</span>
			<select class="input" bind:value={fStatus}><option value="">Any</option>{#each statusOptions as st (st)}<option value={st}>{statusLabel(st)}</option>{/each}</select>
		</label>
		{#if filtering}<button class="btn btn-link" onclick={clearFilters}>Clear filters</button>{/if}
	</div>
{/if}

<!-- ── Matrix ─────────────────────────────────────────────────────────────── -->
{#if data.books.length === 0}
	<div class="matrix-empty">
		<p><strong>No books yet.</strong> {data.stages.length ? 'Add books to plan their tasks from the pipeline.' : 'Build the pipeline, then add books.'}</p>
		{#if data.canManageSeries}<a class="btn btn-primary" href="/s/{data.series.id}/settings#pipeline">Open settings</a>{/if}
	</div>
{:else}
<div class="matrix-outer">
	<table class="matrix" data-tour="matrix">
		<thead>
			<tr>
				<th class="col-book th-book">Book</th>
				{#each data.stages as stage (stage.id)}
					<th class="col-stage" data-cat={stage.category} title={stage.name}>
						<span class="stage-abbr">{stage.name}</span>
					</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each bookGroups as group (group.label)}
				<tr class="group-row">
					<td class="group-label" colspan={data.stages.length + 1}>{group.label}</td>
				</tr>
				{#each group.books as book (book.id)}
					<tr class="book-row">
						<td class="col-book book-cell">
							<a class="book-code" href="/s/{data.series.id}/books/{encodeURIComponent(book.code)}">{book.code}</a>
							<span class="book-name">{book.name}</span>
						</td>
						{#each data.stages as stage (stage.id)}
							{#if stageApplies(book.trackId, stage.id)}
								{@const task = taskMap.get(`${book.id}:${stage.id}`)}
								<td class="col-stage stage-cell">
									{#if task}
										{@const lead = leadMap.get(task.id)}
										<button
											class="chip"
											class:faded={(fPerson || fStatus) && !matches(task)}
											data-status={task.status}
											title="{statusLabel(task.status)} · {task.endDate}"
											onclick={() => openTask(task.id)}
											aria-label="{book.code} {stage.name}: {statusLabel(task.status)}, ends {fmtDate(task.endDate)}{lead ? `, ${lead.displayName}` : isUnassigned(task) ? ', unassigned' : ''}"
										>
											<span class="chip-status">{statusLabel(task.status)}</span>
											{#if lead}
												<span class="chip-avatar">{initials(lead.displayName)}</span>
											{:else if isUnassigned(task)}
												<span class="chip-unassigned">Unassigned</span>
											{/if}
											<span class="chip-date">{fmtDate(task.endDate)}</span>
											{#if data.reviewsDone[task.id] || task.status === 'in_review'}
												<span class="chip-reviews" title="Reviews done{task.status === 'in_review' ? ', one pending' : ''}">✓{data.reviewsDone[task.id] ?? 0}{#if task.status === 'in_review'} · ⏳{/if}</span>
											{/if}
											{#if (stage.key === 'printing' || stage.key === 'binding') && data.copies[book.id]}
												{@const c = data.copies[book.id]}
												<span class="chip-copies" title="Copies {stage.key === 'printing' ? 'printed' : 'bound'} against the print run">{stage.key === 'printing' ? c.printed : c.bound} of {c.run}</span>
											{/if}
										</button>
									{:else}
										<div class="chip chip--empty">—</div>
									{/if}
								</td>
							{:else}
								<td class="col-stage stage-cell stage-cell--na"></td>
							{/if}
						{/each}
					</tr>
				{/each}
			{/each}
		</tbody>
	</table>
</div>
{/if}

<style>
	/* ── Header strip ────────────────────────────────────────────────────────── */
	.series-strip {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: var(--sp-3);
		padding: var(--sp-4) var(--sp-6);
		border-bottom: 1px solid var(--border);
		background: var(--background);
	}
	.strip-title { display: flex; align-items: baseline; gap: var(--sp-4); }
	.series-name { font-size: 20px; font-weight: 700; }
	.strip-date  { font-size: 12px; color: var(--muted-foreground); }
	.strip-meta  { display: flex; align-items: center; gap: var(--sp-4); flex-wrap: wrap; font-size: 13px; }
	.meta-item   { color: var(--muted-foreground); }
	.meta-item strong { color: var(--foreground); }
	.projected-late { color: var(--danger) !important; }
	.meta-badge {
		padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600;
	}
	.badge-late { background: var(--danger-subtle); color: var(--danger); }
	.badge-risk { background: var(--tertiary-subtle); color: var(--tertiary-foreground); }

	/* ── Matrix wrapper ──────────────────────────────────────────────────────── */
	.filters { display: flex; flex-wrap: wrap; gap: var(--sp-3); align-items: flex-end; padding: var(--sp-3) var(--sp-6); border-bottom: 1px solid var(--border); }
	.filters label { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--muted-foreground); font-weight: 500; }
	.filters .input { min-width: 140px; padding-top: 4px; padding-bottom: 4px; font-size: 13px; }
	.badge-unassigned { border: 1px dashed var(--muted-foreground); cursor: pointer; background: var(--muted); color: var(--foreground); font: inherit; font-size: 12px; font-weight: 600; }
	.chip-unassigned { font-size: 10px; font-weight: 700; color: var(--tertiary-foreground); background: var(--tertiary-subtle); padding: 0 4px; border-radius: 3px; }
	button.chip { width: 100%; border: none; font: inherit; text-align: center; cursor: pointer; }
	button.chip:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 1px; }
	.chip.faded { opacity: 0.25; }
	.matrix-empty {
		margin: var(--sp-6); padding: var(--sp-8); text-align: center; background: var(--muted); border-radius: var(--radius);
		display: flex; flex-direction: column; align-items: center; gap: var(--sp-3); color: var(--muted-foreground);
	}
	.matrix-empty strong { color: var(--foreground); }
	.matrix-outer {
		overflow-x: auto;
		overflow-y: auto;
		height: calc(100vh - 49px - 57px); /* viewport minus nav and strip */
	}

	/* ── Table ───────────────────────────────────────────────────────────────── */
	.matrix {
		border-collapse: collapse;
		min-width: 100%;
		table-layout: fixed;
	}

	/* ── Book column (sticky left) ────────────────────────────────────────────── */
	.col-book {
		position: sticky;
		left: 0;
		z-index: 2;
		background: var(--background);
		width: 128px;
		min-width: 128px;
		border-right: 2px solid var(--border);
	}
	thead .col-book { z-index: 4; }

	/* ── Stage columns ───────────────────────────────────────────────────────── */
	.col-stage {
		width: 90px;
		min-width: 90px;
		text-align: center;
	}

	/* ── Header row ──────────────────────────────────────────────────────────── */
	thead tr th {
		position: sticky;
		top: 0;
		background: var(--muted);
		z-index: 3;
		padding: var(--sp-2) var(--sp-1);
		border-bottom: 2px solid var(--border);
		font-size: 11px;
		font-weight: 600;
		white-space: normal;
		word-break: break-word;
	}
	.th-book { text-align: left; padding-left: var(--sp-3); font-size: 12px; }
	.stage-abbr { display: block; line-height: 1.3; }

	/* Stage category header tints */
	thead .col-stage[data-cat="creation"]   { background: var(--primary-subtle); }
	thead .col-stage[data-cat="review"]     { background: var(--secondary-subtle); }
	thead .col-stage[data-cat="layout"]     { background: var(--tertiary-subtle); }
	thead .col-stage[data-cat="publish"]    { background: var(--publish-subtle); }
	thead .col-stage[data-cat="production"] { background: var(--production-subtle); }
	thead .col-stage[data-cat="gate"]       { background: var(--muted); }

	/* ── Group rows ──────────────────────────────────────────────────────────── */
	.group-row .group-label {
		background: var(--muted);
		padding: var(--sp-2) var(--sp-3);
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted-foreground);
		border-top: 2px solid var(--border);
		position: sticky;
		left: 0;
	}

	/* ── Book rows ───────────────────────────────────────────────────────────── */
	.book-row:hover td { background: color-mix(in srgb, var(--primary-subtle) 30%, transparent); }
	.book-cell {
		padding: var(--sp-2) var(--sp-3);
		vertical-align: middle;
	}
	.book-code {
		display: block;
		font-size: 13px;
		font-weight: 700;
		color: var(--foreground);
	}
	.book-name {
		display: block;
		font-size: 11px;
		color: var(--muted-foreground);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	td.col-book { border-bottom: 1px solid var(--border); }

	/* ── Stage cells ─────────────────────────────────────────────────────────── */
	.stage-cell {
		padding: 3px;
		border-bottom: 1px solid var(--border);
		border-left: 1px solid var(--border);
		vertical-align: top;
	}
	.stage-cell--na { background: var(--muted); }
</style>
