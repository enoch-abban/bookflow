<script lang="ts">
	import { tick } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { api } from '#lib/api-client.ts';
	import { statusLabel } from '#lib/status.ts';
	import { taskDrawer, closeTask, openTask } from '#lib/task-drawer.svelte.ts';
	import type { TaskDetail } from '#lib/server/task-detail.ts';

	// The task drawer (spec: Task drawer). Opens over any page; coordinators edit everything,
	// assignees change status and add notes, everyone reads and comments.

	let detail = $state<TaskDetail | null>(null);
	let loading = $state(false);
	let failed = $state<string | null>(null);
	let notice = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);
	let busy = $state(false);
	let panel = $state<HTMLElement>();
	let closeBtn = $state<HTMLButtonElement>();
	let opener: HTMLElement | null = null;

	// Edit drafts, reset whenever the task loads.
	let status = $state('');
	let blockedReason = $state('');
	let returnSummary = $state('');
	let returning = $state(false);
	let fields = $state({ title: '', notes: '', feedbackUrl: '' });
	let dates = $state({ start: '', duration: 1 });
	let picking = $state(false);
	let picked = $state<{ personId: string; name: string }[]>([]);
	let leadId = $state<string | null>(null);
	let comment = $state('');
	let addPred = $state('');
	let addSucc = $state('');

	const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	const fmt = (d: string | null) => (d ? `${MONTHS[+d.slice(5, 7)]} ${+d.slice(8, 10)}` : '—');
	const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

	async function load(id: string, quiet = false) {
		if (!quiet) loading = true;
		failed = null;
		const res = await api<TaskDetail>('GET', `/api/tasks/${id}`);
		loading = false;
		if (taskDrawer.taskId !== id) return; // another task was opened meanwhile
		if (!res.ok) {
			failed = res.message;
			detail = null;
			return;
		}
		const d = res.data;
		detail = d;
		status = '';
		blockedReason = '';
		returning = false;
		returnSummary = '';
		fields = { title: d.task.title, notes: d.task.notes ?? '', feedbackUrl: d.task.feedbackUrl ?? '' };
		dates = { start: d.task.startDate, duration: d.task.durationDays };
		picking = false;
		addPred = '';
		addSucc = '';
	}

	// Open, switch and close follow the shared state; focus goes into the drawer and back.
	let shown: string | null = null;
	$effect(() => {
		const id = taskDrawer.taskId;
		if (id === shown) return;
		if (id && !shown) opener = document.activeElement as HTMLElement | null;
		shown = id;
		notice = null;
		if (id) {
			load(id);
			tick().then(() => closeBtn?.focus());
		} else {
			detail = null;
			opener?.focus?.();
		}
	});

	/** Run a write, then reload the drawer and the page under it. */
	async function write(p: ReturnType<typeof api>, ok: string) {
		if (!detail) return false;
		busy = true;
		notice = null;
		const res = await p;
		busy = false;
		const id = detail.task.id;
		if (!res.ok) {
			notice = { kind: 'error', text: res.status === 409 && !res.body?.message ? 'Someone else changed this task, so it has been reloaded. Check it and try again.' : res.message };
			await load(id, true);
			return false;
		}
		notice = { kind: 'ok', text: ok };
		await Promise.all([load(id, true), invalidateAll()]);
		return true;
	}

	const v = () => detail!.task.version;
	const taskUrl = () => `/api/tasks/${detail!.task.id}`;

	function changeStatus(e: SubmitEvent) {
		e.preventDefault();
		if (!status) return;
		const body: Record<string, unknown> = { status, version: v() };
		if (status === 'blocked') body.blockedReason = blockedReason;
		write(api('PATCH', taskUrl(), body), `Status set to ${statusLabel(status)}.`);
	}

	function review(outcome: 'approved' | 'changes_requested') {
		write(api('POST', `${taskUrl()}/review`, { outcome, summary: outcome === 'changes_requested' ? returnSummary : null, version: v() }),
			outcome === 'approved' ? 'Approved: the task is Done.' : 'Returned with changes.');
	}

	function saveFields(e: SubmitEvent) {
		e.preventDefault();
		const d = detail!;
		const body: Record<string, unknown> = { version: v() };
		if (d.viewer.isCoord && fields.title.trim() !== d.task.title) body.title = fields.title.trim();
		if (fields.notes !== (d.task.notes ?? '')) body.notes = fields.notes;
		if (fields.feedbackUrl !== (d.task.feedbackUrl ?? '')) body.feedbackUrl = fields.feedbackUrl.trim();
		if (Object.keys(body).length === 1) return;
		write(api('PATCH', taskUrl(), body), 'Saved.');
	}

	function saveDates(e: SubmitEvent) {
		e.preventDefault();
		write(api('POST', `${taskUrl()}/schedule`, { start: dates.start, durationDays: Number(dates.duration), version: v() }), 'Dates saved; later tasks moved along where needed.');
	}

	function toggleOverflow() {
		write(api('PATCH', taskUrl(), { overflowAllowed: !detail!.task.overflowAllowed, version: v() }),
			detail!.task.overflowAllowed ? 'Overflow no longer allowed.' : 'Overflow allowed.');
	}

	// ── Assignee picker ──────────────────────────────────────────────────────
	// The first person added leads by default; removing the lead promotes the next one.

	function startPicking() {
		picked = detail!.assignees.map((a) => ({ personId: a.personId, name: a.name }));
		leadId = detail!.assignees.find((a) => a.isLead)?.personId ?? picked[0]?.personId ?? null;
		picking = true;
	}
	function addPerson(m: { personId: string; name: string }) {
		if (picked.some((p) => p.personId === m.personId)) return;
		picked = [...picked, m];
		leadId ??= m.personId;
	}
	function removePerson(id: string) {
		picked = picked.filter((p) => p.personId !== id);
		if (leadId === id) leadId = picked[0]?.personId ?? null;
	}
	function saveAssignees() {
		write(api('POST', `${taskUrl()}/assignees`, { personIds: picked.map((p) => p.personId), leadId, version: v() }),
			picked.length ? `Assigned to ${picked.map((p) => p.name).join(', ')}.` : 'The task is now unassigned.');
	}
	const teams = $derived(
		(detail?.members ?? []).reduce<{ team: string; members: TaskDetail['members'] }[]>((acc, m) => {
			if (acc.at(-1)?.team === m.team) acc.at(-1)!.members.push(m);
			else acc.push({ team: m.team, members: [m] });
			return acc;
		}, [])
	);
	function load_(m: TaskDetail['members'][number]) {
		if (!detail?.workDays) return '';
		if (m.overDays) return `already at capacity on ${m.overDays} of ${detail.workDays} ${detail.workDays === 1 ? 'day' : 'days'}`;
		if (!m.busyDays) return 'free';
		return `some work on ${m.busyDays} of ${detail.workDays} ${detail.workDays === 1 ? 'day' : 'days'}`;
	}

	// ── Links and comments ───────────────────────────────────────────────────

	function link(which: 'pred' | 'succ') {
		const other = which === 'pred' ? addPred : addSucc;
		if (!other) return;
		const id = detail!.task.id;
		const body = which === 'pred' ? { predecessorId: other, successorId: id } : { predecessorId: id, successorId: other };
		write(api('POST', '/api/dependencies', body), 'Linked; later tasks moved along where needed.');
	}
	function unlink(depId: string) {
		write(api('DELETE', `/api/dependencies/${depId}`), 'Link removed.');
	}
	async function addComment(e: SubmitEvent) {
		e.preventDefault();
		if (await write(api('POST', `${taskUrl()}/comments`, { body: comment }), 'Comment added.')) comment = '';
	}

	function onKey(e: KeyboardEvent) {
		if (taskDrawer.taskId && e.key === 'Escape' && !picking) {
			e.preventDefault();
			closeTask();
		}
	}

	// Keep Tab inside the drawer while it is open.
	function trap(e: KeyboardEvent) {
		if (e.key !== 'Tab' || !panel) return;
		const f = [...panel.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea')].filter((x) => !x.hasAttribute('disabled'));
		if (!f.length) return;
		if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1)!.focus(); }
		else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
	}
</script>

<svelte:window onkeydown={onKey} />

{#if taskDrawer.taskId}
	<div class="backdrop" onclick={closeTask} role="presentation"></div>
	<div class="drawer" bind:this={panel} role="dialog" aria-modal="true" aria-labelledby="drawer-title" onkeydown={trap} tabindex="-1">
		<header class="d-head">
			<div class="d-title">
				{#if detail}
					<p class="d-crumb"><a href="/s/{detail.series.id}/books/{encodeURIComponent(detail.book.code)}" onclick={closeTask}>{detail.book.code}</a> · {detail.stage.name}</p>
					<h2 id="drawer-title">{detail.task.title}</h2>
				{:else}
					<h2 id="drawer-title">{failed ? 'Task unavailable' : 'Loading task…'}</h2>
				{/if}
			</div>
			<button class="btn btn-ghost close" bind:this={closeBtn} onclick={closeTask} aria-label="Close">×</button>
		</header>

		{#if failed}
			<p class="notice notice--error" role="alert">{failed}</p>
		{:else if detail}
			{@const d = detail}
			{@const canEdit = d.viewer.isCoord || d.viewer.isAssignee}
			<div class="d-body" class:dim={loading}>
				<div class="chips">
					<span class="chip chip--inline" data-status={d.task.status}>{statusLabel(d.task.status)}</span>
					{#if d.task.iteration > 1}<span class="tag">round {d.task.iteration}</span>{/if}
					{#if d.task.scheduleState === 'unscheduled'}<span class="tag tag--warn">Unscheduled</span>{/if}
					{#if !d.assignees.length}<span class="tag tag--warn">Unassigned</span>{/if}
				</div>
				{#if notice}<p class="notice notice--{notice.kind}" role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p>{/if}

				<!-- Status and review -->
				<section>
					<h3>Status</h3>
					{#if d.task.status === 'blocked' && d.task.blockedReason}<p class="muted">Blocked: {d.task.blockedReason}</p>{/if}
					{#if d.task.status === 'in_review'}
						<p class="muted">Waiting on {d.reviewers.length ? d.reviewers.join(', ') : 'a coordinator'}.</p>
					{/if}
					{#if d.viewer.canReview}
						{#if returning}
							<form class="row" onsubmit={(e) => { e.preventDefault(); review('changes_requested'); }}>
								<input class="input grow" bind:value={returnSummary} maxlength="1000" required placeholder="What needs changing (detail stays in the Drive file)" />
								<button class="btn btn-secondary" disabled={busy}>Return</button>
								<button type="button" class="btn btn-ghost" onclick={() => (returning = false)}>Cancel</button>
							</form>
						{:else}
							<div class="row">
								<button class="btn btn-primary" disabled={busy} onclick={() => review('approved')}>Approve</button>
								<button class="btn btn-ghost" onclick={() => (returning = true)}>Return with changes</button>
							</div>
						{/if}
					{/if}
					{#if d.statusOptions.length}
						<form class="row" onsubmit={changeStatus}>
							<select class="input" bind:value={status} aria-label="New status">
								<option value="">Change status…</option>
								{#each d.statusOptions as s (s)}<option value={s}>{statusLabel(s)}</option>{/each}
							</select>
							{#if status === 'blocked'}<input class="input grow" bind:value={blockedReason} required maxlength="500" placeholder="What is it waiting on?" />{/if}
							<button class="btn btn-primary" disabled={busy || !status}>Set</button>
						</form>
					{:else if d.stage.category === 'gate' && d.task.status !== 'done'}
						<p class="muted">Completes when the book is approved for print on its page.</p>
					{/if}
				</section>

				<!-- Assignees -->
				<section>
					<div class="sec-head">
						<h3>Assignees</h3>
						{#if d.viewer.isCoord && !picking}<button class="btn btn-link" onclick={startPicking}>Edit</button>{/if}
					</div>
					{#if !picking}
						{#if d.assignees.length}
							<ul class="people">
								{#each d.assignees as a (a.personId)}
									<li>{#if a.isLead}<span class="star" title="Lead" aria-label="Lead">★</span>{/if}{a.name}</li>
								{/each}
							</ul>
						{:else}
							<p class="muted">Nobody yet{d.viewer.isCoord ? '' : '. A coordinator can assign it'}.</p>
						{/if}
					{:else}
						<div class="picker">
							{#if picked.length}
								<ul class="people picked">
									{#each picked as p (p.personId)}
										<li>
											<button class="star-btn" class:on={leadId === p.personId} onclick={() => (leadId = p.personId)} aria-pressed={leadId === p.personId} title="Make lead" aria-label="Make {p.name} lead">★</button>
											<span class="grow">{p.name}</span>
											<button class="btn btn-link" onclick={() => removePerson(p.personId)} aria-label="Remove {p.name}">Remove</button>
										</li>
									{/each}
								</ul>
							{:else}
								<p class="muted">No one selected: saving leaves the task unassigned.</p>
							{/if}
							<p class="hint">Add people{d.workDays ? `; workload is over this task's ${d.workDays} working days` : ''}:</p>
							<div class="candidates">
								{#each teams as g (g.team)}
									{@const left = g.members.filter((m) => !picked.some((p) => p.personId === m.personId))}
									{#if left.length}<p class="team">{g.team}</p>{/if}
									{#each left as m (m.personId)}
										<button class="cand" onclick={() => addPerson(m)}>
											<span>{m.name}</span>
											<span class="load" class:over={m.overDays > 0}>{load_(m)}</span>
										</button>
									{/each}
								{/each}
							</div>
							<div class="row">
								<button class="btn btn-primary" disabled={busy} onclick={saveAssignees}>Save assignees</button>
								<button class="btn btn-ghost" onclick={() => (picking = false)}>Cancel</button>
							</div>
						</div>
					{/if}
				</section>

				<!-- Dates -->
				<section>
					<h3>Dates</h3>
					<dl class="facts">
						<dt>Planned</dt><dd>{d.task.scheduleState === 'unscheduled' ? 'Unscheduled' : `${fmt(d.task.startDate)} – ${fmt(d.task.endDate)}`}</dd>
						<dt>Duration</dt><dd>{d.task.durationDays} working {d.task.durationDays === 1 ? 'day' : 'days'}</dd>
						{#if d.task.window}<dt>Window</dt><dd>{d.task.window}</dd>{/if}
						{#if d.task.dueDate}<dt>Due</dt><dd>{fmt(d.task.dueDate)}</dd>{/if}
					</dl>
					{#if d.viewer.isCoord && d.task.status === 'not_started'}
						<form class="row" onsubmit={saveDates}>
							<label class="field small"><span>Start</span><input class="input" type="date" bind:value={dates.start} required /></label>
							<label class="field small"><span>Working days</span><input class="input" type="number" min={d.stage.category === 'gate' ? 0 : 1} max="60" bind:value={dates.duration} required /></label>
							<button class="btn btn-ghost" disabled={busy || (dates.start === d.task.startDate && Number(dates.duration) === d.task.durationDays)}>Move</button>
						</form>
					{/if}
					{#if d.viewer.isCoord && d.series.enforceWindows && d.series.windowOverflowDays > 0}
						<label class="check">
							<input type="checkbox" checked={d.task.overflowAllowed} disabled={busy} onchange={toggleOverflow} />
							Allow overflow <span class="hint">may run up to {d.series.windowOverflowDays} working days past its window</span>
						</label>
					{/if}
				</section>

				<!-- Details -->
				{#if canEdit}
					<form class="sec-form" onsubmit={saveFields}>
						<h3>Details</h3>
						{#if d.viewer.isCoord}<label class="field"><span>Title</span><input class="input" bind:value={fields.title} required maxlength="120" /></label>{/if}
						<label class="field"><span>Feedback file <span class="hint">Google Drive link</span></span><input class="input" type="url" bind:value={fields.feedbackUrl} placeholder="https://drive.google.com/…" /></label>
						<label class="field"><span>Notes</span><textarea class="input" rows="3" bind:value={fields.notes} maxlength="4000"></textarea></label>
						<div><button class="btn btn-ghost" disabled={busy}>Save details</button></div>
					</form>
				{:else}
					<section>
						<h3>Details</h3>
						{#if d.task.feedbackUrl}<p><a href={d.task.feedbackUrl} target="_blank" rel="noopener">Feedback file</a></p>{/if}
						<p class="notes">{d.task.notes || 'No notes.'}</p>
					</section>
				{/if}

				<!-- Links -->
				<section>
					<h3>Comes after</h3>
					{#each d.predecessors as p (p.depId)}
						<div class="link-row">
							<button class="btn-link grow" onclick={() => openTask(p.taskId)}>{p.label}</button>
							<span class="muted">ends {fmt(p.endDate)}</span>
							{#if d.viewer.isCoord}<button class="btn btn-link danger" disabled={busy} onclick={() => unlink(p.depId)} aria-label="Remove link to {p.label}">Unlink</button>{/if}
						</div>
					{:else}<p class="muted">Nothing; it can start any time.</p>{/each}
					{#if d.viewer.isCoord}
						<div class="row"><select class="input grow" bind:value={addPred} aria-label="Add a task this comes after"><option value="">Add a task this comes after…</option>{#each d.linkable as t (t.id)}<option value={t.id}>{t.label}</option>{/each}</select><button class="btn btn-ghost" disabled={busy || !addPred} onclick={() => link('pred')}>Link</button></div>
					{/if}
					<h3>Comes before</h3>
					{#each d.successors as s (s.depId)}
						<div class="link-row">
							<button class="btn-link grow" onclick={() => openTask(s.taskId)}>{s.label}</button>
							<span class="muted">starts {fmt(s.startDate)}</span>
							{#if d.viewer.isCoord}<button class="btn btn-link danger" disabled={busy} onclick={() => unlink(s.depId)} aria-label="Remove link to {s.label}">Unlink</button>{/if}
						</div>
					{:else}<p class="muted">Nothing waits on it.</p>{/each}
					{#if d.viewer.isCoord}
						<div class="row"><select class="input grow" bind:value={addSucc} aria-label="Add a task that comes after this"><option value="">Add a task that comes after this…</option>{#each d.linkable as t (t.id)}<option value={t.id}>{t.label}</option>{/each}</select><button class="btn btn-ghost" disabled={busy || !addSucc} onclick={() => link('succ')}>Link</button></div>
					{/if}
				</section>

				<!-- Comments -->
				<section>
					<h3>Comments</h3>
					<form class="row" onsubmit={addComment}>
						<textarea class="input grow" rows="2" bind:value={comment} maxlength="2000" required placeholder="Write a comment"></textarea>
						<button class="btn btn-ghost" disabled={busy || !comment.trim()}>Post</button>
					</form>
					{#each d.comments as c (c.id)}
						<div class="comment"><p class="meta">{c.author} · {when(c.at)}</p><p>{c.body}</p></div>
					{/each}
				</section>

				<!-- Activity -->
				<section>
					<h3>Activity</h3>
					{#each d.activity as a (a.id)}
						<p class="act"><span>{a.line}</span><span class="meta">{a.actor} · {when(a.at)}</span></p>
					{:else}<p class="muted">No changes yet.</p>{/each}
				</section>
			</div>
		{/if}
	</div>
{/if}

<style>
	.backdrop { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.3); z-index: 900; }
	.drawer {
		position: fixed; top: 0; right: 0; bottom: 0; width: min(460px, 100vw); z-index: 901;
		background: var(--background); border-left: 1px solid var(--border); box-shadow: -12px 0 32px rgba(15, 23, 42, 0.15);
		display: flex; flex-direction: column; outline: none;
	}
	.d-head { display: flex; align-items: flex-start; gap: var(--sp-3); padding: var(--sp-4) var(--sp-5); border-bottom: 1px solid var(--border); }
	.d-title { flex: 1; min-width: 0; }
	.d-crumb { font-size: 12px; color: var(--muted-foreground); margin: 0; }
	.d-crumb a { color: var(--primary); font-weight: 600; }
	h2 { font-size: 18px; font-weight: 700; margin: 2px 0 0; }
	.close { font-size: 18px; line-height: 1; padding: 2px 10px; }
	.d-body { overflow-y: auto; padding: var(--sp-4) var(--sp-5) var(--sp-8); display: flex; flex-direction: column; gap: var(--sp-5); }
	.d-body.dim { opacity: 0.6; }
	section, .sec-form { display: flex; flex-direction: column; gap: var(--sp-2); }
	h3 { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted-foreground); margin: 0; }
	.sec-head { display: flex; justify-content: space-between; align-items: baseline; }
	.chips { display: flex; gap: var(--sp-2); flex-wrap: wrap; align-items: center; }
	.chip--inline { padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; min-height: auto; }
	.tag { font-size: 11px; font-weight: 700; padding: 2px 6px; border-radius: 4px; background: var(--muted); color: var(--muted-foreground); }
	.tag--warn { background: var(--tertiary-subtle); color: var(--tertiary-foreground); }
	.muted, .hint { color: var(--muted-foreground); font-size: 12px; margin: 0; }
	.row { display: flex; gap: var(--sp-2); align-items: flex-end; flex-wrap: wrap; }
	.grow { flex: 1; min-width: 0; }
	.field.small { max-width: 150px; }
	.check { display: flex; gap: var(--sp-2); align-items: center; font-size: 13px; flex-wrap: wrap; }
	.facts { display: grid; grid-template-columns: auto 1fr; gap: 2px var(--sp-4); margin: 0; font-size: 13px; }
	.facts dt { color: var(--muted-foreground); }
	.facts dd { margin: 0; }
	.people { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-1); font-size: 14px; }
	.people li { display: flex; align-items: center; gap: var(--sp-2); }
	.star { color: var(--tertiary); }
	.picker { display: flex; flex-direction: column; gap: var(--sp-2); border: 1px solid var(--border); border-radius: var(--radius); padding: var(--sp-3); }
	.star-btn { border: none; background: none; font-size: 16px; color: var(--border); cursor: pointer; padding: 0 2px; }
	.star-btn.on { color: var(--tertiary); }
	.candidates { max-height: 260px; overflow-y: auto; display: flex; flex-direction: column; border-top: 1px solid var(--muted); }
	.team { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted-foreground); margin: var(--sp-2) 0 2px; }
	.cand { display: flex; justify-content: space-between; gap: var(--sp-2); border: none; background: none; text-align: left; padding: 6px var(--sp-2); border-radius: var(--radius-sm); font-size: 13px; cursor: pointer; color: var(--foreground); }
	.cand:hover, .cand:focus-visible { background: var(--primary-subtle); }
	.load { font-size: 12px; color: var(--muted-foreground); }
	.load.over { color: var(--danger); font-weight: 600; }
	.link-row { display: flex; align-items: center; gap: var(--sp-2); font-size: 13px; }
	.link-row .btn-link { text-align: left; background: none; border: none; padding: 0; color: var(--primary); cursor: pointer; }
	.danger { color: var(--danger); }
	.notes { white-space: pre-wrap; font-size: 13px; margin: 0; }
	.comment { border-top: 1px solid var(--muted); padding-top: var(--sp-2); font-size: 13px; }
	.comment p { margin: 0; white-space: pre-wrap; }
	.meta { font-size: 12px; color: var(--muted-foreground); }
	.act { display: flex; flex-direction: column; font-size: 13px; margin: 0; padding: var(--sp-1) 0; border-top: 1px solid var(--muted); }
</style>
