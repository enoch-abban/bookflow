<script lang="ts">
	import { untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { api } from '#lib/api-client.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	type Member = (typeof data.members)[number];
	type Flash = { ok: boolean; text: string } | null;

	const STATUS_LABEL: Record<string, string> = {
		active: 'Active', invited: 'Invited', placeholder: 'Placeholder', deactivated: 'Deactivated'
	};
	const ROLE_LABEL: Record<string, string> = { coordinator: 'Coordinator', contributor: 'Contributor', viewer: 'Viewer' };

	// ── General and print settings ───────────────────────────────────────────
	// Form copies of the saved values; resynced from the server after each save.
	const generalFromServer = () => ({
		name: data.series.name,
		status: data.series.status,
		targetDate: data.series.targetDate,
		hardLimitDate: data.series.hardLimitDate ?? '',
		bookGroupLabel: data.series.bookGroupLabel,
		enforceWindows: !!data.series.enforceWindows,
		strictMode: !!data.series.strictMode
	});
	const printFromServer = () => ({
		defaultCopies: data.series.defaultCopies,
		legalDepositCopies: data.series.legalDepositCopies,
		printBufferDays: data.series.printBufferDays
	});
	let general = $state(generalFromServer());
	let print = $state(printFromServer());
	let generalFlash = $state<Flash>(null);
	let printFlash = $state<Flash>(null);
	let busy = $state(false);

	const generalDirty = $derived(
		general.name !== data.series.name ||
			general.status !== data.series.status ||
			general.targetDate !== data.series.targetDate ||
			(general.hardLimitDate || null) !== data.series.hardLimitDate ||
			general.bookGroupLabel !== data.series.bookGroupLabel ||
			general.enforceWindows !== !!data.series.enforceWindows ||
			general.strictMode !== !!data.series.strictMode
	);
	const printDirty = $derived(
		print.defaultCopies !== data.series.defaultCopies ||
			print.legalDepositCopies !== data.series.legalDepositCopies ||
			print.printBufferDays !== data.series.printBufferDays
	);

	async function save(body: Record<string, unknown>, set: (f: Flash) => void, resync: () => void) {
		busy = true;
		const res = await api('PATCH', `/api/series/${data.series.id}`, body);
		busy = false;
		set(res.ok ? { ok: true, text: 'Saved.' } : { ok: false, text: res.message });
		if (res.ok) {
			await invalidateAll();
			resync();
		}
	}

	function saveGeneral(e: SubmitEvent) {
		e.preventDefault();
		save({ ...general, hardLimitDate: general.hardLimitDate || null }, (f) => (generalFlash = f), () => (general = generalFromServer()));
	}
	function savePrint(e: SubmitEvent) {
		e.preventDefault();
		save({ ...print }, (f) => (printFlash = f), () => (print = printFromServer()));
	}

	// ── Team ────────────────────────────────────────────────────────────────
	type Draft = { role: string; teamLabel: string; capacity: number };
	const toDraft = (m: Member): Draft => ({ role: m.role, teamLabel: m.teamLabel ?? '', capacity: m.capacity });

	// One editable draft per member. After a reload, rows with unsaved edits keep them.
	let drafts = $state<Record<string, Draft>>({});
	let synced: Record<string, Draft> = {};
	$effect(() => {
		const next: Record<string, Draft> = {};
		const current = untrack(() => drafts);
		for (const m of data.members) {
			const fresh = toDraft(m);
			const prev = current[m.personId];
			const old = synced[m.personId];
			const untouched = !prev || !old || JSON.stringify(prev) === JSON.stringify(old);
			next[m.personId] = untouched ? fresh : prev;
			synced[m.personId] = fresh;
		}
		drafts = next;
	});
	const isDirty = (m: Member) => {
		const d = drafts[m.personId];
		return !!d && (d.role !== m.role || d.teamLabel !== (m.teamLabel ?? '') || d.capacity !== m.capacity);
	};

	let teamFlash = $state<Flash>(null);
	let inviteFor = $state<string | null>(null);
	let inviteEmail = $state('');

	const groups = $derived.by(() => {
		const map = new Map<string, Member[]>();
		for (const m of data.members) {
			const key = m.teamLabel || 'No team label';
			map.set(key, [...(map.get(key) ?? []), m]);
		}
		return [...map.entries()];
	});

	async function teamCall(method: string, url: string, body: unknown, okText: string) {
		busy = true;
		teamFlash = null;
		const res = await api(method, url, body);
		busy = false;
		teamFlash = res.ok ? { ok: true, text: okText } : { ok: false, text: res.message };
		if (res.ok) {
			inviteFor = null;
			await invalidateAll();
		}
		return res.ok;
	}

	function saveMember(m: Member) {
		const d = drafts[m.personId];
		teamCall('PUT', `/api/series/${data.series.id}/members/${m.personId}`,
			{ role: d.role, teamLabel: d.teamLabel || null, capacity: Number(d.capacity) }, `Updated ${m.displayName}.`);
	}

	function openInvite(m: Member) {
		inviteFor = inviteFor === m.personId ? null : m.personId;
		inviteEmail = m.email ?? '';
	}

	// Add an existing person, or a new placeholder.
	let addMode = $state<'existing' | 'new'>('existing');
	let add = $state({ personId: '', displayName: '', email: '', role: 'contributor', teamLabel: '', capacity: 1 });

	async function addMember(e: SubmitEvent) {
		e.preventDefault();
		const teamLabel = add.teamLabel.trim() || null;
		const ok =
			addMode === 'existing'
				? await teamCall('PUT', `/api/series/${data.series.id}/members/${add.personId}`,
					{ role: add.role, teamLabel, capacity: Number(add.capacity) }, 'Member added.')
				: await teamCall('POST', '/api/people',
					{ displayName: add.displayName.trim(), email: add.email.trim() || undefined, seriesId: data.series.id, role: add.role, teamLabel: teamLabel ?? undefined },
					`Added ${add.displayName.trim()}.`);
		if (ok) add = { personId: '', displayName: '', email: '', role: 'contributor', teamLabel: '', capacity: 1 };
	}

	const canEditRole = (m: Member) => data.me.isAdmin || m.role !== 'coordinator';
	const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
</script>

<svelte:head><title>Settings · {data.series.name}</title></svelte:head>

<datalist id="team-labels">
	{#each data.teamLabels as l (l)}<option value={l}></option>{/each}
</datalist>

<div class="settings">
	<header class="page-header">
		<h1>{data.series.name} settings</h1>
		<nav class="toc" aria-label="Sections">
			<a href="#general">General</a>
			<a href="#print">Print and publishing</a>
			<a href="#team">Team</a>
		</nav>
	</header>

	<!-- General ─────────────────────────────────────────────────────────── -->
	<section id="general" class="card">
		<h2>General</h2>
		<form onsubmit={saveGeneral}>
			<div class="grid">
				<label class="field span-2">
					<span>Series name</span>
					<input class="input" bind:value={general.name} maxlength="120" required />
				</label>
				<label class="field">
					<span>Status</span>
					<select class="input" bind:value={general.status}>
						<option value="planning">Planning</option>
						<option value="active">Active</option>
						<option value="closed">Closed</option>
					</select>
				</label>
				<label class="field">
					<span>Starts</span>
					<input class="input" type="date" value={data.series.startDate} disabled />
				</label>
				<label class="field">
					<span>Target date</span>
					<input class="input" type="date" bind:value={general.targetDate} min={data.series.startDate} required />
				</label>
				<label class="field">
					<span>Hard limit <span class="hint">optional</span></span>
					<input class="input" type="date" bind:value={general.hardLimitDate} min={general.targetDate} />
				</label>
				<label class="field">
					<span>Book group label <span class="hint">e.g. Grade group</span></span>
					<input class="input" bind:value={general.bookGroupLabel} maxlength="40" required />
				</label>
			</div>

			<label class="switch">
				<input type="checkbox" bind:checked={general.enforceWindows} />
				<span>
					<strong>Enforce windows</strong>
					<span class="hint">Every task must sit inside one window and can't cross its edges. Publishing stages are always exempt.</span>
				</span>
			</label>
			<label class="switch">
				<input type="checkbox" bind:checked={general.strictMode} />
				<span>
					<strong>Strict mode</strong>
					<span class="hint">Block dropping a task before its predecessor ends, instead of flagging it at risk.</span>
				</span>
			</label>

			<div class="form-foot">
				{#if generalFlash}<p class="notice" class:notice--ok={generalFlash.ok} class:notice--error={!generalFlash.ok} role="status">{generalFlash.text}</p>{/if}
				<button class="btn btn-primary btn-lg" disabled={busy || !generalDirty}>Save changes</button>
			</div>
		</form>
	</section>

	<!-- Print and publishing ────────────────────────────────────────────── -->
	<section id="print" class="card">
		<h2>Print and publishing</h2>
		<p class="lede">Defaults for new print records. Books that already have a print record keep their numbers.</p>
		<form onsubmit={savePrint}>
			<div class="grid">
				<label class="field">
					<span>Copies per book</span>
					<input class="input" type="number" min="0" step="1" bind:value={print.defaultCopies} required />
				</label>
				<label class="field">
					<span>Legal deposit copies</span>
					<input class="input" type="number" min="0" step="1" bind:value={print.legalDepositCopies} required />
				</label>
				<label class="field">
					<span>Print buffer <span class="hint">working days after each batch</span></span>
					<input class="input" type="number" min="0" max="30" step="1" bind:value={print.printBufferDays} required />
				</label>
			</div>
			<p class="hint">Each book prints {print.defaultCopies + print.legalDepositCopies} copies ({print.defaultCopies} planned + {print.legalDepositCopies} for legal deposit).</p>
			<div class="form-foot">
				{#if printFlash}<p class="notice" class:notice--ok={printFlash.ok} class:notice--error={!printFlash.ok} role="status">{printFlash.text}</p>{/if}
				<button class="btn btn-primary btn-lg" disabled={busy || !printDirty}>Save changes</button>
			</div>
		</form>
	</section>

	<!-- Team ────────────────────────────────────────────────────────────── -->
	<section id="team" class="card">
		<h2>Team</h2>
		<p class="lede">Roles set what people can do on this series. Team labels group swimlane lanes and the workload view. Capacity is task days per working day.</p>

		{#if teamFlash}<p class="notice" class:notice--ok={teamFlash.ok} class:notice--error={!teamFlash.ok} role="status">{teamFlash.text}</p>{/if}

		<div class="table-wrap">
			<table>
				<thead>
					<tr><th>Person</th><th>Role</th><th>Team label</th><th class="num">Capacity</th><th class="right">Actions</th></tr>
				</thead>
				{#each groups as [label, list] (label)}
					<tbody>
						<tr class="group-row"><th colspan="5">{label} <span class="n">{list.length}</span></th></tr>
						{#each list as m (m.personId)}
							{@const d = drafts[m.personId]}
							{#if d}
								<tr class:dim={m.status === 'deactivated'}>
									<td>
										<div class="name">{m.displayName}{#if m.personId === data.me.personId}<span class="tag">You</span>{/if}</div>
										<div class="muted">
											<span class="status" data-status={m.status}>{STATUS_LABEL[m.status]}</span>
											{#if m.invite}expires {fmtDate(m.invite.expiresAt)}{:else}{m.email ?? ''}{/if}
										</div>
									</td>
									<td>
										<select class="input" bind:value={d.role} disabled={!canEditRole(m)}
											title={canEditRole(m) ? undefined : 'Only an admin can change a coordinator'}>
											{#each Object.entries(ROLE_LABEL) as [value, text] (value)}
												<option {value} disabled={value === 'coordinator' && !data.me.isAdmin && m.role !== 'coordinator'}>{text}</option>
											{/each}
										</select>
									</td>
									<td><input class="input" list="team-labels" bind:value={d.teamLabel} maxlength="60" placeholder="None" /></td>
									<td class="num"><input class="input cap" type="number" min="0.25" max="20" step="0.25" bind:value={d.capacity} /></td>
									<td class="right">
										<div class="actions">
											{#if isDirty(m)}
												<button class="btn btn-primary" disabled={busy} onclick={() => saveMember(m)}>Save</button>
												<button class="btn btn-ghost" onclick={() => (drafts[m.personId] = toDraft(m))}>Undo</button>
											{/if}
											{#if m.status === 'placeholder' || m.status === 'invited'}
												<button class="btn btn-ghost" onclick={() => openInvite(m)}>{m.invite ? 'Resend' : 'Invite'}</button>
											{/if}
											{#if m.invite && (data.me.isAdmin || m.invite.invitedBy === data.me.personId)}
												<button class="btn btn-ghost" disabled={busy}
													onclick={() => teamCall('DELETE', `/api/invites/${m.invite!.id}`, undefined, 'Invite revoked.')}>Revoke</button>
											{/if}
										</div>
									</td>
								</tr>
								{#if inviteFor === m.personId}
									<tr class="expand">
										<td colspan="5">
											<form class="inline-form" onsubmit={(e) => { e.preventDefault(); teamCall('POST', `/api/people/${m.personId}/invite`, { email: inviteEmail.trim() }, `Invite sent to ${inviteEmail.trim()}.`); }}>
												<label class="field grow">
													<span>Send {m.invite ? 'a new' : 'an'} invite to</span>
													<!-- svelte-ignore a11y_autofocus -->
													<input class="input" type="email" bind:value={inviteEmail} required autofocus />
												</label>
												<button class="btn btn-primary btn-lg" disabled={busy}>Send invite</button>
												<button type="button" class="btn btn-ghost btn-lg" onclick={() => (inviteFor = null)}>Cancel</button>
											</form>
										</td>
									</tr>
								{/if}
							{/if}
						{/each}
					</tbody>
				{/each}
			</table>
		</div>

		<form class="add-member" onsubmit={addMember}>
			<div class="add-head">
				<h3>Add to team</h3>
				<div class="seg" role="radiogroup" aria-label="Who to add">
					<label><input type="radio" bind:group={addMode} value="existing" /> Existing person</label>
					<label><input type="radio" bind:group={addMode} value="new" /> New placeholder</label>
				</div>
			</div>
			<div class="add-fields">
				{#if addMode === 'existing'}
					<label class="field grow">
						<span>Person</span>
						<select class="input" bind:value={add.personId} required>
							<option value="" disabled>Choose…</option>
							{#each data.others as p (p.id)}<option value={p.id}>{p.displayName}</option>{/each}
						</select>
					</label>
				{:else}
					<label class="field grow">
						<span>Display name</span>
						<input class="input" bind:value={add.displayName} maxlength="80" placeholder="e.g. Reviewer 5" required />
					</label>
					<label class="field grow">
						<span>Email <span class="hint">optional</span></span>
						<input class="input" type="email" bind:value={add.email} />
					</label>
				{/if}
				<label class="field">
					<span>Role</span>
					<select class="input" bind:value={add.role}>
						{#each Object.entries(ROLE_LABEL) as [value, text] (value)}
							<option {value} disabled={value === 'coordinator' && !data.me.isAdmin}>{text}</option>
						{/each}
					</select>
				</label>
				<label class="field">
					<span>Team label</span>
					<input class="input" list="team-labels" bind:value={add.teamLabel} maxlength="60" placeholder="None" />
				</label>
				{#if addMode === 'existing'}
					<label class="field">
						<span>Capacity</span>
						<input class="input cap" type="number" min="0.25" max="20" step="0.25" bind:value={add.capacity} />
					</label>
				{/if}
				<button class="btn btn-primary btn-lg" disabled={busy}>Add</button>
			</div>
		</form>
	</section>
</div>

<style>
	.settings { max-width: 960px; margin: 0 auto; padding: var(--sp-6) var(--sp-4) var(--sp-8); display: flex; flex-direction: column; gap: var(--sp-6); }
	.page-header { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--sp-3); }
	.page-header h1 { font-size: 22px; font-weight: 700; }
	.toc { display: flex; flex-wrap: wrap; gap: var(--sp-4); font-size: 13px; }

	.card { border: 1px solid var(--border); border-radius: var(--radius); padding: var(--sp-5) var(--sp-5) var(--sp-6); display: flex; flex-direction: column; gap: var(--sp-4); scroll-margin-top: 64px; }
	.card h2 { font-size: 16px; font-weight: 700; }
	.card h3 { font-size: 14px; font-weight: 600; }
	.lede { margin: calc(-1 * var(--sp-2)) 0 0; color: var(--muted-foreground); font-size: 13px; }
	form { display: flex; flex-direction: column; gap: var(--sp-4); }

	.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: var(--sp-4); }
	.span-2 { grid-column: span 2; }
	@media (max-width: 480px) { .span-2 { grid-column: auto; } }

	.switch { display: flex; gap: var(--sp-3); align-items: flex-start; cursor: pointer; }
	.switch input { margin-top: 3px; accent-color: var(--primary); width: 16px; height: 16px; flex-shrink: 0; }
	.switch > span { display: flex; flex-direction: column; font-size: 13px; }
	.hint { font-size: 12px; color: var(--muted-foreground); }

	.form-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: var(--sp-3); }
	.form-foot .notice { margin: 0 auto 0 0; }

	.table-wrap { overflow-x: auto; }
	table { width: 100%; border-collapse: collapse; font-size: 13px; }
	thead th { text-align: left; font-size: 12px; font-weight: 600; color: var(--muted-foreground); padding: var(--sp-2) var(--sp-2); border-bottom: 1px solid var(--border); }
	.group-row th { text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted-foreground); padding: var(--sp-4) var(--sp-2) var(--sp-1); }
	td { padding: var(--sp-2); border-bottom: 1px solid var(--border); vertical-align: middle; }
	td .input { width: 100%; min-width: 110px; padding: var(--sp-1) var(--sp-2); }
	td .input.cap, .cap { width: 80px; min-width: 0; }
	tr.dim td { opacity: 0.6; }
	tr.expand td { background: var(--muted); padding: var(--sp-3); }
	.num { text-align: right; }
	.right { text-align: right; }
	.n { font-weight: 400; }
	.name { font-weight: 600; display: flex; gap: var(--sp-2); align-items: center; }
	.muted { color: var(--muted-foreground); font-size: 12px; display: flex; gap: var(--sp-2); align-items: center; }
	.tag { font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 4px; background: var(--muted); color: var(--muted-foreground); }
	.actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--sp-2); }

	.status { font-size: 11px; font-weight: 500; padding: 0 6px; border-radius: 999px; }
	.status[data-status='active'] { background: var(--success-subtle); color: var(--success); }
	.status[data-status='invited'] { background: var(--secondary-subtle); color: var(--secondary-foreground); }
	.status[data-status='placeholder'] { background: var(--muted); color: var(--muted-foreground); }
	.status[data-status='deactivated'] { background: var(--danger-subtle); color: var(--danger); }

	.inline-form { flex-direction: row; flex-wrap: wrap; align-items: flex-end; gap: var(--sp-3); }
	.grow { flex: 1 1 200px; }

	.add-member { background: var(--muted); border-radius: var(--radius); padding: var(--sp-4); gap: var(--sp-3); }
	.add-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--sp-3); }
	.seg { display: flex; gap: var(--sp-4); font-size: 13px; }
	.seg input { accent-color: var(--primary); }
	.add-fields { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--sp-3); }
</style>
