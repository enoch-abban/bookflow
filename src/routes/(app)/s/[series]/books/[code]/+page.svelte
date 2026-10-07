<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const STATUS_LABEL: Record<string, string> = {
		not_started: 'Not started', in_progress: 'In progress', in_review: 'In review',
		returned: 'Returned', done: 'Done', blocked: 'Blocked', skipped: 'Skipped', missing: 'No task'
	};
	const fmtDate = (iso: string | null) =>
		iso ? new Date(iso + (iso.length === 10 ? 'T12:00:00Z' : '')).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '–';
	const fmtDateTime = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
	const today = new Date().toISOString().slice(0, 10);

	function variance(v: number | null) {
		if (v === null) return { text: '–', cls: '' };
		if (v === 0) return { text: 'On plan', cls: 'ok' };
		return v > 0 ? { text: `+${v}d late`, cls: 'late' } : { text: `${-v}d early`, cls: 'ok' };
	}

	// Hyphen positions depend on the agency's range tables, so the 13 digits are shown as issued.
	const isbnShown = $derived(data.book.isbn);
	const finished = $derived(
		!!data.printRecord && data.printRecord.copiesBound >= data.printRecord.copiesPlanned + data.printRecord.depositCopies && !!data.printRecord.depositSubmittedOn
	);
	const late = (t: (typeof data.tasks)[number]) => t.status !== 'done' && t.endDate < today;
</script>

<svelte:head><title>{data.book.code} · {data.series.name}</title></svelte:head>

<div class="book-page">
	<nav class="crumbs"><a href="/s/{data.series.id}">{data.series.name}</a> / {data.book.code}</nav>

	<header class="page-header">
		<div>
			<h1>{data.book.code} <span class="name">{data.book.name}</span></h1>
			<p class="meta">
				{data.book.trackName}
				{#if data.book.groupLabel} · {data.series.bookGroupLabel}: {data.book.groupLabel}{/if}
				{#if data.book.batch} · Batch {data.book.batch}{/if}
				{#if data.book.archivedAt}<span class="badge badge--muted">Archived {fmtDate(data.book.archivedAt.slice(0, 10))}</span>{/if}
				{#if finished}<span class="badge badge--ok">Finished</span>{/if}
			</p>
		</div>
		<dl class="facts">
			<div><dt>ISBN</dt><dd>{isbnShown ?? 'Not issued yet'}</dd></div>
			<div><dt>Edition</dt><dd>{data.book.edition ?? '–'}</dd></div>
			<div><dt>Projected finish</dt><dd>{fmtDate(data.projectedFinish)}{#if data.projectedFinish && data.series.hardLimitDate && data.projectedFinish > data.series.hardLimitDate}<span class="flag">past hard limit</span>{:else if data.projectedFinish && data.projectedFinish > data.series.targetDate}<span class="flag flag--warn">behind target</span>{/if}</dd></div>
			<div><dt>Legal deposit due</dt><dd>{fmtDate(data.depositDue)}</dd></div>
		</dl>
	</header>

	<!-- Pipeline stepper -->
	<section class="card">
		<h2>Pipeline</h2>
		<ol class="stepper" aria-label="Stages">
			{#each data.stepper as s, i (s.id)}
				<li class="step" data-state={s.state} data-category={s.category}>
					<span class="dot" aria-hidden="true">{s.category === 'gate' ? '' : s.state === 'done' ? '✓' : i + 1}</span>
					<span class="step-name">{s.name}</span>
					<span class="step-state">{STATUS_LABEL[s.state] ?? s.state}</span>
				</li>
			{/each}
		</ol>
	</section>

	<!-- Tasks -->
	<section class="card">
		<h2>Tasks {#if data.baseline}<span class="hint">variance against the {data.baseline.name} baseline</span>{/if}</h2>
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th>Stage</th><th>Status</th><th>Lead</th><th>Planned</th><th>Window</th>
						<th>Baseline end</th><th>Variance</th><th>Due</th><th>Reviews</th>
					</tr>
				</thead>
				<tbody>
					{#each data.tasks as t (t.id)}
						{@const v = variance(t.variance)}
						<tr class:dim={t.stageArchived}>
							<td>
								<div class="stage">{t.stage}{#if t.iteration > 1}<span class="iter">×{t.iteration}</span>{/if}</div>
								{#if t.stageArchived}<div class="muted">archived stage</div>{/if}
								{#if t.feedbackUrl}<a class="muted" href={t.feedbackUrl} target="_blank" rel="noopener">Feedback file</a>{/if}
							</td>
							<td>
								<span class="status" data-status={t.status}>{STATUS_LABEL[t.status]}</span>
								{#if late(t)}<span class="flag">Late</span>{/if}
								{#if t.scheduleState === 'unscheduled'}<span class="flag flag--warn">Unscheduled</span>{/if}
							</td>
							<td>{t.lead ?? '–'}{#if t.others.length}<div class="muted">+ {t.others.join(', ')}</div>{/if}</td>
							<td class="nowrap">{fmtDate(t.startDate)} → {fmtDate(t.endDate)}<div class="muted">{t.durationDays} {t.durationDays === 1 ? 'day' : 'days'}</div></td>
							<td class="muted">{t.window ?? '–'}</td>
							<td class="nowrap">{fmtDate(t.baselineEnd)}</td>
							<td class="nowrap variance {v.cls}">{v.text}</td>
							<td class="nowrap">{#if t.dueDate}{fmtDate(t.dueDate)}{#if t.status !== 'done' && t.endDate > t.dueDate}<span class="flag">past due</span>{/if}{:else}–{/if}</td>
							<td class="nowrap">
								{#if t.reviewsDone || t.reviewPending}
									<span class="review" title="Reviews recorded">✓ {t.reviewsDone}</span>
									{#if t.reviewPending}<span class="review review--pending" title="Waiting for review">⏳ 1</span>{/if}
								{:else}–{/if}
							</td>
						</tr>
					{:else}
						<tr><td colspan="9" class="empty">This book has no tasks.</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<div class="two-col">
		<!-- Print approval and print record -->
		<section class="card">
			<h2>Print</h2>
			{#if data.approval}
				<p class="approval approval--ok">Approved for print by <strong>{data.approval.by}</strong> on {fmtDateTime(data.approval.at)}.{#if data.approval.note} “{data.approval.note}”{/if}</p>
			{:else}
				<p class="approval">Not approved for print yet. Approval opens once every earlier task is Done, including the ISBN.</p>
			{/if}
			{#if data.printRecord}
				{@const r = data.printRecord}
				<dl class="record">
					<div><dt>Copies planned</dt><dd>{r.copiesPlanned} + {r.depositCopies} for legal deposit</dd></div>
					<div><dt>Printed</dt><dd>{r.copiesPrinted}{#if r.printedOn} on {fmtDate(r.printedOn)}{/if}</dd></div>
					<div><dt>Sent to binder</dt><dd>{fmtDate(r.sentToBinderOn)}{#if r.binderName} · {r.binderName}{/if}</dd></div>
					<div><dt>Back from binder</dt><dd>{fmtDate(r.returnedFromBinderOn)}</dd></div>
					<div><dt>Bound</dt><dd>{r.copiesBound} of {r.copiesPlanned + r.depositCopies}</dd></div>
					<div><dt>Deposit submitted</dt><dd>{fmtDate(r.depositSubmittedOn)}</dd></div>
				</dl>
				{#if r.notes}<p class="muted">{r.notes}</p>{/if}
			{:else}
				<p class="muted">No print record.</p>
			{/if}
		</section>

		<!-- Review history and comments -->
		<section class="card">
			<h2>Review history</h2>
			{#each data.reviews as r (r.id)}
				<div class="entry">
					<div><strong>{r.stage}</strong> · round {r.iteration} · <span class:returned={r.outcome === 'changes_requested'}>{r.outcome === 'approved' ? 'Approved' : 'Returned with changes'}</span> by {r.reviewer}</div>
					<div class="muted">{fmtDateTime(r.at)}</div>
					{#if r.comments}<p>{r.comments}</p>{/if}
				</div>
			{:else}
				<p class="muted">No reviews recorded yet.</p>
			{/each}

			<h2 class="spaced">Comments</h2>
			{#each data.comments as c (c.id)}
				<div class="entry">
					<div><strong>{c.author}</strong> on {c.stage}</div>
					<div class="muted">{fmtDateTime(c.at)}</div>
					<p>{c.body}</p>
				</div>
			{:else}
				<p class="muted">No comments yet.</p>
			{/each}
		</section>
	</div>
</div>

<style>
	.book-page { max-width: 1120px; margin: 0 auto; padding: var(--sp-5) var(--sp-4) var(--sp-8); display: flex; flex-direction: column; gap: var(--sp-5); }
	.crumbs { font-size: 13px; color: var(--muted-foreground); }
	.page-header { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--sp-5); }
	.page-header h1 { font-size: 24px; font-weight: 700; }
	.name { font-weight: 400; color: var(--muted-foreground); }
	.meta { margin: var(--sp-1) 0 0; color: var(--muted-foreground); font-size: 13px; display: flex; flex-wrap: wrap; gap: var(--sp-2); align-items: center; }
	.facts { display: grid; grid-template-columns: repeat(2, minmax(140px, auto)); gap: var(--sp-2) var(--sp-6); margin: 0; }
	.facts dt, .record dt { font-size: 12px; color: var(--muted-foreground); }
	.facts dd, .record dd { margin: 0; font-weight: 600; font-variant-numeric: tabular-nums; }

	.card { border: 1px solid var(--border); border-radius: var(--radius); padding: var(--sp-4) var(--sp-5); display: flex; flex-direction: column; gap: var(--sp-3); min-width: 0; }
	.card h2 { font-size: 15px; font-weight: 700; }
	.spaced { margin-top: var(--sp-3); }
	.hint { font-size: 12px; font-weight: 400; color: var(--muted-foreground); }
	.muted { color: var(--muted-foreground); font-size: 12px; }
	.two-col { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: var(--sp-5); }

	.badge { font-size: 11px; font-weight: 600; padding: 1px 8px; border-radius: 999px; }
	.badge--muted { background: var(--muted); color: var(--muted-foreground); }
	.badge--ok { background: var(--success-subtle); color: var(--success); }
	.flag { margin-left: var(--sp-1); font-size: 11px; font-weight: 600; color: var(--danger); }
	.flag--warn { color: var(--tertiary-foreground); }

	/* Stepper: one step per stage of the book's track */
	.stepper { list-style: none; margin: 0; padding: 0 0 var(--sp-1); display: flex; gap: var(--sp-1); overflow-x: auto; }
	.step { flex: 1 0 96px; display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center; position: relative; padding-top: 2px; }
	.step + .step::before { content: ''; position: absolute; top: 13px; right: calc(50% + 14px); width: calc(100% - 28px); height: 2px; background: var(--border); }
	.dot { width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; border: 2px solid var(--border); background: var(--background); color: var(--muted-foreground); z-index: 1; }
	.step-name { font-size: 12px; font-weight: 600; line-height: 1.2; }
	.step-state { font-size: 11px; color: var(--muted-foreground); }
	.step[data-state='done'] .dot { background: var(--success); border-color: var(--success); color: #fff; }
	.step[data-state='in_progress'] .dot, .step[data-state='in_review'] .dot { border-color: var(--primary); color: var(--primary); }
	.step[data-state='returned'] .dot { border-color: var(--tertiary); color: var(--tertiary-foreground); }
	.step[data-state='blocked'] .dot { border-color: var(--danger); color: var(--danger); }
	.step[data-state='skipped'] .dot, .step[data-state='missing'] .dot { border-style: dashed; }
	.step[data-state='skipped'] .step-name { text-decoration: line-through; color: var(--muted-foreground); font-weight: 400; }
	.step[data-category='gate'] .dot { width: 18px; height: 18px; margin: 3px 0; border-radius: 3px; transform: rotate(45deg); }
	.step[data-category='gate'][data-state='done'] .dot { background: var(--success); }

	.table-wrap { overflow-x: auto; }
	table { width: 100%; border-collapse: collapse; font-size: 13px; }
	th { text-align: left; font-size: 12px; font-weight: 600; color: var(--muted-foreground); padding: var(--sp-2); border-bottom: 1px solid var(--border); white-space: nowrap; }
	td { padding: var(--sp-2); border-bottom: 1px solid var(--border); vertical-align: top; }
	tr.dim td { opacity: 0.6; }
	.nowrap { white-space: nowrap; }
	.stage { font-weight: 600; }
	.iter { margin-left: 4px; font-size: 11px; font-weight: 700; background: var(--tertiary-subtle); color: var(--tertiary-foreground); padding: 0 5px; border-radius: 4px; }
	.empty { text-align: center; color: var(--muted-foreground); padding: var(--sp-6); }
	.variance.late { color: var(--danger); font-weight: 600; }
	.variance.ok { color: var(--success); }
	.review { font-size: 12px; margin-right: 6px; }
	.review--pending { color: var(--secondary-foreground); }

	.status { font-size: 11px; font-weight: 500; padding: 1px 6px; border-radius: 4px; white-space: nowrap; }
	.status[data-status='not_started'] { background: var(--muted); color: var(--muted-foreground); }
	.status[data-status='in_progress'] { background: var(--primary-subtle); color: var(--primary-subtle-foreground); }
	.status[data-status='in_review'] { background: var(--secondary-subtle); color: var(--secondary-foreground); }
	.status[data-status='returned'] { background: var(--tertiary-subtle); color: var(--tertiary-foreground); }
	.status[data-status='done'] { background: var(--success-subtle); color: var(--success); }
	.status[data-status='blocked'] { background: var(--danger-subtle); color: var(--danger); }

	.approval { margin: 0; padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-sm); background: var(--muted); font-size: 13px; }
	.approval--ok { background: var(--success-subtle); color: var(--success); }
	.record { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--sp-2) var(--sp-4); margin: 0; }
	.entry { border-top: 1px solid var(--border); padding-top: var(--sp-2); font-size: 13px; }
	.entry p { margin: var(--sp-1) 0 0; }
	.returned { color: var(--tertiary-foreground); font-weight: 600; }
</style>
