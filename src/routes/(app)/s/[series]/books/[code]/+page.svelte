<script lang="ts">
	import { untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { api } from '#lib/api-client.ts';
	import { isValidIsbn13 } from '#lib/isbn.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// ── Comments (any series member) ────────────────────────────────────────
	let commentTask = $state(untrack(() => data.tasks[0]?.id ?? ''));
	let commentBody = $state('');
	let commentError = $state<string | null>(null);
	async function postComment(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		commentError = null;
		const res = await api('POST', `/api/tasks/${commentTask}/comments`, { body: commentBody.trim() });
		busy = false;
		if (!res.ok) return (commentError = res.message);
		commentBody = '';
		await invalidateAll();
	}

	// ── Critical path for this book (same toggle and memory as the swimlane) ──
	const CP_KEY = 'bookflow:criticalPath';
	let critPath = $state(false);
	$effect(() => {
		try { critPath = localStorage.getItem(CP_KEY) === '1'; } catch { /* storage unavailable */ }
	});
	function toggleCritPath() {
		critPath = !critPath;
		try { localStorage.setItem(CP_KEY, critPath ? '1' : '0'); } catch { /* storage unavailable */ }
	}
	const critical = $derived(new Set(data.criticalIds));

	// ── Publishing: ISBN and edition (coordinators) ─────────────────────────
	let editingPub = $state(false);
	let pub = $state({ isbn: '', edition: '' });
	let pubMessage = $state<{ ok: boolean; text: string } | null>(null);
	let confirmIsbn = $state<string | null>(null);
	let busy = $state(false);
	const isbnLooksWrong = $derived(!!pub.isbn.trim() && !isValidIsbn13(pub.isbn));

	function startPub() {
		pub = { isbn: data.book.isbn ?? '', edition: data.book.edition ?? '' };
		pubMessage = null;
		confirmIsbn = null;
		editingPub = true;
	}

	async function savePub(confirmChange = false) {
		busy = true;
		pubMessage = null;
		const res = await api<{ approvalWithdrawn: boolean }>('PATCH', `/api/books/${data.book.id}/publishing`, {
			isbn: pub.isbn.trim() || null, edition: pub.edition.trim() || null, version: data.book.version,
			...(confirmChange ? { confirmChange: true } : {})
		});
		busy = false;
		if (!res.ok) {
			if (res.body?.error === 'confirm_required') return (confirmIsbn = res.message);
			if (res.body?.error === 'version_conflict') return (pubMessage = { ok: false, text: 'Someone else changed this book. Reload the page and try again.' });
			return (pubMessage = { ok: false, text: res.message });
		}
		confirmIsbn = null;
		editingPub = false;
		approvalMessage = null; // an older "Approved" message would contradict a withdrawal
		blockers = [];
		pubMessage = {
			ok: true,
			text: res.data.approvalWithdrawn
				? 'Saved. The print approval was withdrawn and the gate reset; approve again once the new ISBN is in the files.'
				: 'Saved.'
		};
		await invalidateAll();
	}

	// ── Print record (Production Unit and coordinators) ─────────────────────
	type RecordForm = {
		copiesPlanned: number; depositCopies: number; copiesPrinted: number; printedOn: string;
		sentToBinderOn: string; returnedFromBinderOn: string; copiesBound: number; depositSubmittedOn: string;
		binderName: string; binderContact: string; notes: string;
	};
	let editingRecord = $state(false);
	let rec = $state<RecordForm | null>(null);
	let recMessage = $state<{ ok: boolean; text: string } | null>(null);

	function startRecord() {
		const r = data.printRecord!;
		rec = {
			copiesPlanned: r.copiesPlanned, depositCopies: r.depositCopies, copiesPrinted: r.copiesPrinted,
			printedOn: r.printedOn ?? '', sentToBinderOn: r.sentToBinderOn ?? '', returnedFromBinderOn: r.returnedFromBinderOn ?? '',
			copiesBound: r.copiesBound, depositSubmittedOn: r.depositSubmittedOn ?? '',
			binderName: r.binderName ?? '', binderContact: r.binderContact ?? '', notes: r.notes ?? ''
		};
		recMessage = null;
		editingRecord = true;
	}

	async function saveRecord(e: SubmitEvent) {
		e.preventDefault();
		if (!rec) return;
		busy = true;
		const dateOrNull = (v: string) => v || null;
		const res = await api('PATCH', `/api/books/${data.book.id}/print-record`, {
			...(data.canEdit ? { copiesPlanned: Number(rec.copiesPlanned), depositCopies: Number(rec.depositCopies) } : {}),
			copiesPrinted: Number(rec.copiesPrinted), printedOn: dateOrNull(rec.printedOn),
			sentToBinderOn: dateOrNull(rec.sentToBinderOn), returnedFromBinderOn: dateOrNull(rec.returnedFromBinderOn),
			copiesBound: Number(rec.copiesBound), depositSubmittedOn: dateOrNull(rec.depositSubmittedOn),
			binderName: rec.binderName, binderContact: rec.binderContact, notes: rec.notes,
			version: data.printRecord!.version
		});
		busy = false;
		if (!res.ok) {
			return (recMessage = {
				ok: false,
				text: res.body?.error === 'version_conflict' ? 'Someone else updated this record. Reload the page and try again.' : res.message
			});
		}
		editingRecord = false;
		recMessage = { ok: true, text: 'Print record saved.' };
		await invalidateAll();
	}

	// ── Print approval (coordinators) ───────────────────────────────────────
	let approvalNote = $state('');
	let approvalMessage = $state<{ ok: boolean; text: string } | null>(null);
	let blockers = $state<{ stage: string; status: string }[]>([]);

	async function approve(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		approvalMessage = null;
		blockers = [];
		const res = await api('POST', `/api/books/${data.book.id}/approve-print`, { note: approvalNote.trim() || null });
		busy = false;
		if (!res.ok) {
			blockers = (res.body?.unfinished as { stage: string; status: string }[] | undefined) ?? [];
			return (approvalMessage = { ok: false, text: res.message });
		}
		approvalNote = '';
		approvalMessage = { ok: true, text: 'Approved for print.' };
		await invalidateAll();
	}

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
			<div>
				<dt>ISBN {#if data.canEdit && !data.book.archivedAt && !editingPub}<button class="link" onclick={startPub}>{data.book.isbn ? 'Change' : 'Record'}</button>{/if}</dt>
				<dd>{isbnShown ?? 'Not issued yet'}</dd>
			</div>
			<div><dt>Edition</dt><dd>{data.book.edition ?? '–'}</dd></div>
			<div><dt>Projected finish</dt><dd>{fmtDate(data.projectedFinish)}{#if data.projectedFinish && data.series.hardLimitDate && data.projectedFinish > data.series.hardLimitDate}<span class="flag">past hard limit</span>{:else if data.projectedFinish && data.projectedFinish > data.series.targetDate}<span class="flag flag--warn">behind target</span>{/if}</dd></div>
			<div><dt>Legal deposit due</dt><dd>{fmtDate(data.depositDue)}</dd></div>
		</dl>
	</header>

	{#if editingPub}
		<form class="card pub-form" onsubmit={(e) => { e.preventDefault(); savePub(); }}>
			<h2>ISBN and edition</h2>
			<div class="pub-fields">
				<label class="field">
					<span>ISBN-13 <span class="hint">as issued by the agency; hyphens are fine</span></span>
					<input class="input" bind:value={pub.isbn} inputmode="numeric" maxlength="32" placeholder="978…" aria-invalid={isbnLooksWrong} />
					{#if isbnLooksWrong}<span class="field-error">Not a valid ISBN-13 yet: check the digits and the check digit.</span>{/if}
				</label>
				<label class="field">
					<span>Edition</span>
					<input class="input" bind:value={pub.edition} maxlength="80" placeholder="1st edition, 2026" />
				</label>
			</div>
			{#if confirmIsbn}
				<div class="confirm" role="alertdialog" aria-label="Confirm ISBN change">
					<p>{confirmIsbn}</p>
					<div class="actions">
						<button type="button" class="btn btn-ghost btn-lg" onclick={() => (confirmIsbn = null)}>Keep the current ISBN</button>
						<button type="button" class="btn btn-danger btn-lg" disabled={busy} onclick={() => savePub(true)}>Change ISBN</button>
					</div>
				</div>
			{:else}
				<div class="actions">
					<button type="button" class="btn btn-ghost btn-lg" onclick={() => (editingPub = false)}>Cancel</button>
					<button class="btn btn-primary btn-lg" disabled={busy || isbnLooksWrong}>Save</button>
				</div>
			{/if}
			{#if pubMessage && !pubMessage.ok}<p class="notice notice--error" role="alert">{pubMessage.text}</p>{/if}
		</form>
	{/if}
	{#if pubMessage?.ok}<p class="notice notice--ok" role="status">{pubMessage.text}</p>{/if}

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
		<div class="card-head">
			<h2>Tasks {#if data.baseline}<span class="hint">variance against the {data.baseline.name} baseline</span>{/if}</h2>
			<button class="cp-toggle" class:on={critPath} aria-pressed={critPath} onclick={toggleCritPath}
				title="Outline the tasks that cannot slip without delaying this book's binding">Critical path</button>
		</div>
		{#if critPath}
			<p class="hint">
				{#if data.criticalIds.length}{data.criticalIds.length} of this book's tasks cannot slip without delaying its binding.{:else}No task is on the critical path for this book.{/if}
			</p>
		{/if}
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
						<tr class:dim={t.stageArchived} class:cp-on={critPath && critical.has(t.id)} class:cp-dim={critPath && !critical.has(t.id)}>
							<td>
								<div class="stage">{t.stage}{#if t.iteration > 1}<span class="iter">×{t.iteration}</span>{/if}</div>
								{#if t.stageArchived}<div class="muted">archived stage</div>{/if}
								{#if t.feedbackUrl}<a class="muted" href={t.feedbackUrl} target="_blank" rel="noopener">Feedback file</a>{/if}
							</td>
							<td>
								<span class="status" data-status={t.status}>{STATUS_LABEL[t.status]}</span>
								{#if late(t)}<span class="flag">Late</span>{/if}
								{#if t.status === 'in_review'}<div class="muted">waiting on {data.waitingOn[t.id]?.length ? data.waitingOn[t.id].join(', ') : 'a coordinator'}</div>{/if}
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
				{#if data.canEdit && !data.book.archivedAt}
					<form class="approve" onsubmit={approve}>
						<label class="field">
							<span>Note <span class="hint">optional</span></span>
							<input class="input" bind:value={approvalNote} maxlength="500" placeholder="e.g. Final PDF checked against the cover" />
						</label>
						<button class="btn btn-primary btn-lg" disabled={busy}>Approve for print</button>
					</form>
				{/if}
			{/if}
			{#if approvalMessage}
				<div class="notice" class:notice--ok={approvalMessage.ok} class:notice--error={!approvalMessage.ok} role="status">
					{approvalMessage.text}
					{#if blockers.length}
						<ul class="blockers">{#each blockers as b (b.stage)}<li>{b.stage}: {STATUS_LABEL[b.status] ?? b.status}</li>{/each}</ul>
					{/if}
				</div>
			{/if}
			{#if editingRecord && rec}
				<form class="record-form" onsubmit={saveRecord}>
					{#if data.canEdit}
						<div class="rf-row">
							<label class="field"><span>Copies planned</span><input class="input" type="number" min="0" bind:value={rec.copiesPlanned} /></label>
							<label class="field"><span>Legal deposit copies</span><input class="input" type="number" min="0" bind:value={rec.depositCopies} /></label>
						</div>
					{/if}
					<div class="rf-row">
						<label class="field"><span>Copies printed</span><input class="input" type="number" min="0" bind:value={rec.copiesPrinted} /></label>
						<label class="field"><span>Printed on</span><input class="input" type="date" bind:value={rec.printedOn} /></label>
					</div>
					<div class="rf-row">
						<label class="field"><span>Sent to binder</span><input class="input" type="date" bind:value={rec.sentToBinderOn} /></label>
						<label class="field"><span>Back from binder</span><input class="input" type="date" bind:value={rec.returnedFromBinderOn} min={rec.sentToBinderOn || undefined} /></label>
					</div>
					<div class="rf-row">
						<label class="field"><span>Binder</span><input class="input" bind:value={rec.binderName} maxlength="120" /></label>
						<label class="field"><span>Binder contact</span><input class="input" bind:value={rec.binderContact} maxlength="200" /></label>
					</div>
					<div class="rf-row">
						<label class="field"><span>Copies bound <span class="hint">of {Number(rec.copiesPlanned) + Number(rec.depositCopies)}</span></span><input class="input" type="number" min="0" max={rec.copiesPrinted} bind:value={rec.copiesBound} /></label>
						<label class="field"><span>Deposit submitted</span><input class="input" type="date" bind:value={rec.depositSubmittedOn} /></label>
					</div>
					<label class="field"><span>Notes</span><textarea class="input" rows="2" bind:value={rec.notes} maxlength="2000"></textarea></label>
					<div class="actions">
						<button type="button" class="btn btn-ghost btn-lg" onclick={() => (editingRecord = false)}>Cancel</button>
						<button class="btn btn-primary btn-lg" disabled={busy}>Save record</button>
					</div>
				</form>
			{:else if data.printRecord}
				{@const r = data.printRecord}
				{#if data.canEditRecord}<button class="link link--block" onclick={startRecord}>Update print record</button>{/if}
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
			{#if recMessage}<p class="notice" class:notice--ok={recMessage.ok} class:notice--error={!recMessage.ok} role="status">{recMessage.text}</p>{/if}
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
			{#if data.tasks.length && !data.book.archivedAt}
				<form class="comment-form" onsubmit={postComment}>
					<select class="input" bind:value={commentTask} aria-label="Task">
						{#each data.tasks as t (t.id)}<option value={t.id}>{t.stage}</option>{/each}
					</select>
					<textarea class="input" rows="2" bind:value={commentBody} maxlength="2000" placeholder="Add a comment for the team" aria-label="Comment"></textarea>
					<div class="actions">
						{#if commentError}<span class="field-error">{commentError}</span>{/if}
						<button class="btn btn-primary" disabled={busy || !commentBody.trim()}>Post comment</button>
					</div>
				</form>
			{/if}
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
	.card-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--sp-2); }
	.cp-toggle { border: 1px solid var(--border); border-radius: 6px; padding: 4px 10px; font-size: 12px; font-weight: 500; background: var(--background); color: var(--muted-foreground); }
	.cp-toggle.on { background: var(--primary-subtle); color: var(--primary); border-color: transparent; }
	tr.cp-on td { box-shadow: inset 0 2px 0 var(--primary-active), inset 0 -2px 0 var(--primary-active); }
	tr.cp-on td:first-child { box-shadow: inset 2px 2px 0 var(--primary-active), inset 0 -2px 0 var(--primary-active); }
	tr.cp-on td:last-child { box-shadow: inset -2px 2px 0 var(--primary-active), inset 0 -2px 0 var(--primary-active); }
	tr.cp-dim td { opacity: 0.4; }
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

	.link { background: none; border: none; padding: 0; margin-left: var(--sp-2); color: var(--primary); font-size: 12px; }
	.link:hover { text-decoration: underline; }
	.link--block { margin: 0; align-self: flex-start; font-size: 13px; }
	.record-form { display: flex; flex-direction: column; gap: var(--sp-3); }
	.rf-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--sp-3); }
	.pub-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: var(--sp-3); }
	.field-error { font-size: 12px; color: var(--danger); }
	.actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--sp-2); }
	.confirm { border: 1px solid var(--tertiary); background: var(--tertiary-subtle); color: var(--tertiary-foreground); border-radius: var(--radius-sm); padding: var(--sp-3); display: flex; flex-direction: column; gap: var(--sp-2); }
	.confirm p { margin: 0; }
	.approve { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--sp-2); }
	.approve .field { flex: 1 1 220px; }
	.comment-form { display: flex; flex-direction: column; gap: var(--sp-2); }
	.blockers { margin: var(--sp-1) 0 0; padding-left: var(--sp-5); }
	.approval { margin: 0; padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-sm); background: var(--muted); font-size: 13px; }
	.approval--ok { background: var(--success-subtle); color: var(--success); }
	.record { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--sp-2) var(--sp-4); margin: 0; }
	.entry { border-top: 1px solid var(--border); padding-top: var(--sp-2); font-size: 13px; }
	.entry p { margin: var(--sp-1) 0 0; }
	.returned { color: var(--tertiary-foreground); font-weight: 600; }
</style>
