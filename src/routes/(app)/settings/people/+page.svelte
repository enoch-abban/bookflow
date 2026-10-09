<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { PageProps } from './$types';
	import { ROLE_LABEL, ROLE_SUMMARY, type SystemRole } from '#lib/roles.ts';

	let { data }: PageProps = $props();

	type Person = (typeof data.people)[number];
	type Mode = 'invite' | 'rename' | 'deactivate' | 'role';
	const ROLES: SystemRole[] = ['admin', 'manager', 'member'];
	// The role chosen in a person's menu, waiting for confirmation.
	let pendingRole = $state<SystemRole | null>(null);

	function chooseRole(p: Person, role: SystemRole) {
		if (role === p.systemRole) return;
		pendingRole = role;
		open = { id: p.id, mode: 'role' };
	}

	const STATUS_LABEL: Record<string, string> = {
		active: 'Active',
		invited: 'Invited',
		placeholder: 'Placeholder',
		deactivated: 'Deactivated'
	};
	const FILTERS = ['all', 'active', 'invited', 'placeholder', 'deactivated'] as const;

	let filter = $state<(typeof FILTERS)[number]>('all');
	let open = $state<{ id: string; mode: Mode } | null>(null);
	let field = $state('');
	let busy = $state(false);
	let flash = $state<{ ok: boolean; text: string } | null>(null);

	let newName = $state('');
	let newEmail = $state('');

	const counts = $derived(
		Object.fromEntries(FILTERS.map((f) => [f, f === 'all' ? data.people.length : data.people.filter((p) => p.status === f).length]))
	);
	const shown = $derived(filter === 'all' ? data.people : data.people.filter((p) => p.status === filter));

	function fmtDate(iso: string) {
		return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}

	function toggle(p: Person, mode: Mode) {
		if (open?.id === p.id && open.mode === mode) return (open = null);
		open = { id: p.id, mode };
		field = mode === 'invite' ? (p.invite?.email ?? p.email ?? '') : mode === 'rename' ? p.displayName : '';
	}

	// Transfer the admin role (spec: Transferring the admin role): pick someone and what you
	// become, get a fresh code by email, then confirm with your password and the code.
	let transferOpen = $state(false);
	let tf = $state({ toPersonId: '', senderNewRole: 'manager' as 'manager' | 'member', password: '', code: '' });
	let codeSent = $state(false);
	async function sendCode() {
		busy = true;
		const res = await fetch('/api/admin-transfers/code', { method: 'POST' });
		busy = false;
		const body = await res.json().catch(() => ({}));
		codeSent = res.ok;
		flash = res.ok ? { ok: true, text: 'We emailed you a 6-digit code. It expires in 10 minutes.' } : { ok: false, text: body.message ?? 'The code could not be sent.' };
	}
	async function startTransfer(e: SubmitEvent) {
		e.preventDefault();
		const name = data.transferTo.find((x) => x.id === tf.toPersonId)?.name ?? 'them';
		if (await call('POST', '/api/admin-transfers', tf, `Transfer sent. ${name} has been emailed a link; nothing changes until they accept.`)) {
			tf = { toPersonId: '', senderNewRole: 'manager', password: '', code: '' };
			codeSent = false;
			transferOpen = false;
		} else {
			tf.code = '';
		}
	}

	async function call(method: string, url: string, body: unknown, okText: string) {
		busy = true;
		flash = null;
		try {
			const res = await fetch(url, {
				method,
				headers: { 'content-type': 'application/json' },
				body: body === undefined ? undefined : JSON.stringify(body)
			});
			if (!res.ok) {
				const msg = await res.json().then((j) => j.message).catch(() => null);
				flash = { ok: false, text: msg ?? `Something went wrong (${res.status}).` };
				return false;
			}
			flash = { ok: true, text: okText };
			open = null;
			await invalidateAll();
			return true;
		} finally {
			busy = false;
		}
	}

	async function addPerson(e: SubmitEvent) {
		e.preventDefault();
		const name = newName.trim();
		if (await call('POST', '/api/people', { displayName: name, email: newEmail.trim() || undefined }, `Added ${name}.`)) {
			newName = '';
			newEmail = '';
		}
	}

	function submitRow(e: SubmitEvent, p: Person) {
		e.preventDefault();
		if (open?.mode === 'invite')
			call('POST', `/api/people/${p.id}/invite`, { email: field.trim() }, `Invite sent to ${field.trim()}.`);
		else if (open?.mode === 'rename')
			call('PATCH', `/api/people/${p.id}`, { displayName: field.trim() }, 'Name updated.');
		else if (open?.mode === 'deactivate')
			call('PATCH', `/api/people/${p.id}`, { active: false }, `${p.displayName} was deactivated and signed out.`);
		else if (open?.mode === 'role' && pendingRole) {
			const role = pendingRole;
			call('PATCH', `/api/people/${p.id}`, { systemRole: role }, p.id === data.meId
				? `You are now ${role === 'admin' ? 'an' : 'a'} ${ROLE_LABEL[role]}.`
				: `${p.displayName} is now ${role === 'admin' ? 'an' : 'a'} ${ROLE_LABEL[role]}${p.hasAccount ? ' and has been emailed about it' : ''}.`);
		}
	}
</script>

<svelte:head><title>People · bookflow</title></svelte:head>

<div class="people-page">
	<header class="page-header">
		<h1>People</h1>
		<p class="sub">Placeholders can be assigned work before they join. Invite them when you know their email.</p>
	</header>

	<form class="add-row" onsubmit={addPerson}>
		<label class="field grow">
			<span>Display name</span>
			<input class="input" bind:value={newName} placeholder="e.g. Designer 4" maxlength="80" required />
		</label>
		<label class="field grow">
			<span>Email <span class="hint">optional</span></span>
			<input class="input" type="email" bind:value={newEmail} placeholder="name@example.com" />
		</label>
		<button class="btn btn-primary btn-lg" disabled={busy || !newName.trim()}>Add person</button>
	</form>

	{#if flash}
		<p class="notice" class:notice--ok={flash.ok} class:notice--error={!flash.ok} role="status">{flash.text}</p>
	{/if}

	{#if data.iAmAdmin}
		<section class="transfer card">
			{#if data.outgoing}
				<div class="transfer-head">
					<div>
						<h2>Admin role transfer waiting</h2>
						<p class="muted">You offered the admin role to <strong>{data.outgoing.to}</strong>; you will become {data.outgoing.senderNewRole === 'manager' ? 'Manager' : 'Member'} when they accept. The link expires {fmtDate(data.outgoing.expiresAt)}.</p>
					</div>
					<button class="btn btn-danger" disabled={busy} onclick={() => call('DELETE', `/api/admin-transfers/${data.outgoing!.id}`, undefined, 'Transfer cancelled. Nothing changed.')}>Cancel transfer</button>
				</div>
			{:else if !transferOpen}
				<div class="transfer-head">
					<div>
						<h2>Transfer admin role</h2>
						<p class="muted">Hand your admin role to someone else, for example when you move on. It only happens when they accept.</p>
					</div>
					<button class="btn btn-ghost" onclick={() => (transferOpen = true)} disabled={!data.transferTo.length}>Transfer admin role</button>
				</div>
				{#if !data.transferTo.length}<p class="muted">Nobody can receive it yet: they need an active account that is not already an admin.</p>{/if}
			{:else}
				<h2>Transfer admin role</h2>
				<form class="transfer-form" onsubmit={startTransfer}>
					<label class="field">
						<span>New admin</span>
						<select class="input" bind:value={tf.toPersonId} required>
							<option value="">Choose a person…</option>
							{#each data.transferTo as x (x.id)}<option value={x.id}>{x.name}</option>{/each}
						</select>
					</label>
					<fieldset class="field">
						<legend>You become</legend>
						<label class="radio"><input type="radio" bind:group={tf.senderNewRole} value="manager" /> Manager <span class="hint">keeps app-wide access, without system roles or holidays</span></label>
						<label class="radio"><input type="radio" bind:group={tf.senderNewRole} value="member" /> Member <span class="hint">only the series roles you hold</span></label>
					</fieldset>
					<p class="muted">This is the most powerful change in the app, so confirm it with your password and a fresh code.</p>
					<div class="confirm-row">
						<label class="field"><span>Your password</span><input class="input" type="password" bind:value={tf.password} required autocomplete="current-password" /></label>
						<label class="field"><span>Code from your email</span><input class="input input--code" inputmode="numeric" maxlength="6" bind:value={tf.code} required placeholder="000000" /></label>
						<button type="button" class="btn btn-ghost btn-lg" disabled={busy} onclick={sendCode}>{codeSent ? 'Send a new code' : 'Email me a code'}</button>
					</div>
					<div class="row">
						<button class="btn btn-primary btn-lg" disabled={busy || !tf.toPersonId || !tf.password || tf.code.length !== 6}>Send transfer</button>
						<button type="button" class="btn btn-ghost btn-lg" onclick={() => { transferOpen = false; codeSent = false; }}>Cancel</button>
					</div>
				</form>
			{/if}
		</section>
	{/if}

	<div class="filters" role="tablist">
		{#each FILTERS as f (f)}
			<button role="tab" aria-selected={filter === f} class="filter" class:on={filter === f} onclick={() => (filter = f)}>
				{f === 'all' ? 'All' : STATUS_LABEL[f]} <span class="n">{counts[f]}</span>
			</button>
		{/each}
	</div>

	<div class="table-wrap">
		<table>
			<thead>
				<tr><th>Name</th><th>App role</th><th>Series and role</th><th>Status</th><th class="right">Actions</th></tr>
			</thead>
			<tbody>
				{#each shown as p (p.id)}
					<tr class:dim={p.status === 'deactivated'}>
						<td>
							<div class="name">
								{p.displayName}
								{#if p.id === data.meId}<span class="tag tag--me">You</span>{/if}
							</div>
							<div class="muted">{p.invite?.email ?? p.email ?? 'No email'}</div>
						</td>
						<td>
							{#if p.canChangeRole}
								<select class="input role-select" aria-label="App role for {p.displayName}" value={p.systemRole}
									onchange={(e) => { chooseRole(p, e.currentTarget.value as SystemRole); e.currentTarget.value = p.systemRole; }}>
									{#each ROLES as r (r)}
										<option value={r}>{ROLE_LABEL[r]}</option>
									{/each}
								</select>
							{:else}
								<span class="tag" class:tag--plain={p.systemRole === 'member'}>{ROLE_LABEL[p.systemRole]}</span>
								{#if p.roleNote}<div class="muted">{p.roleNote}</div>{/if}
							{/if}
						</td>
						<td>
							{#each p.memberships as m (m.seriesName)}
								<div>{m.seriesName} <span class="muted">· {m.role}{m.teamLabel ? `, ${m.teamLabel}` : ''}</span></div>
							{:else}
								<span class="muted">None</span>
							{/each}
						</td>
						<td>
							<span class="status" data-status={p.status}>{STATUS_LABEL[p.status]}</span>
							{#if p.invite}<div class="muted">expires {fmtDate(p.invite.expiresAt)}</div>
							{:else if p.status === 'placeholder' && p.lastInviteState === 'expired'}<div class="muted">invite expired</div>{/if}
						</td>
						<td class="right">
							<div class="actions">
								{#if !p.canEdit}
									<span class="muted">{p.id === data.meId ? 'Rename yourself from the account menu' : 'Admins only'}</span>
								{:else if p.status === 'deactivated'}
									<button class="btn btn-ghost" disabled={busy}
										onclick={() => call('PATCH', `/api/people/${p.id}`, { active: true }, `${p.displayName} was reactivated.`)}>Reactivate</button>
								{:else}
									{#if !p.hasAccount}
										<button class="btn btn-ghost" onclick={() => toggle(p, 'invite')}>{p.invite ? 'Resend' : 'Invite'}</button>
									{/if}
									{#if p.invite}
										<button class="btn btn-ghost" disabled={busy}
											onclick={() => call('DELETE', `/api/invites/${p.invite!.id}`, undefined, 'Invite revoked.')}>Revoke</button>
									{/if}
									{#if p.hasAccount}
										<button class="btn btn-ghost" disabled={busy}
											onclick={() => call('POST', `/api/people/${p.id}/password-reset`, undefined, `Reset link sent to ${p.displayName}.`)}>Send reset link</button>
									{/if}
									<button class="btn btn-ghost" onclick={() => toggle(p, 'rename')}>Rename</button>
									{#if p.canDeactivate}
										<button class="btn btn-danger" onclick={() => toggle(p, 'deactivate')}>Deactivate</button>
									{/if}
								{/if}
							</div>
						</td>
					</tr>
					{#if open?.id === p.id}
						<tr class="expand">
							<td colspan="5">
								<form class="inline-form" onsubmit={(e) => submitRow(e, p)}>
									{#if open.mode === 'invite'}
										<label class="field grow">
											<span>Send {p.invite ? 'a new' : 'an'} invite to</span>
											<!-- svelte-ignore a11y_autofocus -->
											<input class="input" type="email" bind:value={field} required autofocus />
										</label>
										{#if p.invite}<p class="muted note">The earlier link will stop working.</p>{/if}
										<button class="btn btn-primary btn-lg" disabled={busy}>Send invite</button>
									{:else if open.mode === 'rename'}
										<label class="field grow">
											<span>Display name</span>
											<!-- svelte-ignore a11y_autofocus -->
											<input class="input" bind:value={field} maxlength="80" required autofocus />
										</label>
										<button class="btn btn-primary btn-lg" disabled={busy || !field.trim()}>Save</button>
									{:else if open.mode === 'role' && pendingRole}
										<div class="note grow" role="alertdialog" aria-labelledby="role-q-{p.id}">
											<p id="role-q-{p.id}">
												{#if p.id === data.meId}Step down from Admin to <strong>{ROLE_LABEL[pendingRole]}</strong>?
												{:else}Make <strong>{p.displayName}</strong> {pendingRole === 'admin' ? 'an' : 'a'} <strong>{ROLE_LABEL[pendingRole]}</strong> (now {ROLE_LABEL[p.systemRole]})?{/if}
											</p>
											<p class="muted">{ROLE_LABEL[pendingRole]}: {ROLE_SUMMARY[pendingRole]}</p>
											<p class="muted">
												{#if p.id === data.meId}You'll lose admin rights on your next page load.
												{:else}It applies on their next page load without signing them out{p.hasAccount ? ', and they will be emailed about it' : ''}.{/if}
											</p>
										</div>
										<button class="btn btn-primary btn-lg" disabled={busy}>Change role</button>
									{:else}
										<p class="note grow">
											Deactivate <strong>{p.displayName}</strong>? They'll be signed out and can't sign in.
											Their tasks and history stay; reassign any open work.
										</p>
										<button class="btn btn-danger btn-lg" disabled={busy}>Deactivate</button>
									{/if}
									<button type="button" class="btn btn-ghost btn-lg" onclick={() => { open = null; pendingRole = null; }}>Cancel</button>
								</form>
							</td>
						</tr>
					{/if}
				{:else}
					<tr><td colspan="4" class="empty">Nobody here.</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<style>
	.people-page { max-width: 1040px; margin: 0 auto; padding: var(--sp-6) var(--sp-4); display: flex; flex-direction: column; gap: var(--sp-5); }
	.page-header h1 { font-size: 22px; font-weight: 700; }
	.sub { margin: var(--sp-1) 0 0; color: var(--muted-foreground); }

	.add-row, .inline-form { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--sp-3); }
	.add-row { padding: var(--sp-4); background: var(--muted); border-radius: var(--radius); }
	.grow { flex: 1 1 220px; }
	.note { margin: 0; font-size: 13px; }

	.filters { display: flex; flex-wrap: wrap; gap: var(--sp-1); border-bottom: 1px solid var(--border); }
	.filter {
		background: none; border: none; border-bottom: 2px solid transparent;
		padding: var(--sp-2) var(--sp-3); font-size: 13px; color: var(--muted-foreground);
	}
	.filter.on { color: var(--foreground); border-bottom-color: var(--primary); font-weight: 600; }
	.n { font-size: 11px; color: var(--muted-foreground); font-weight: 400; }

	.table-wrap { overflow-x: auto; }
	table { width: 100%; border-collapse: collapse; font-size: 13px; }
	th { text-align: left; font-size: 12px; font-weight: 600; color: var(--muted-foreground); padding: var(--sp-2) var(--sp-3); border-bottom: 1px solid var(--border); }
	td { padding: var(--sp-3); border-bottom: 1px solid var(--border); vertical-align: top; }
	tr.dim td { opacity: 0.6; }
	tr.expand td { background: var(--muted); }
	.right { text-align: right; }
	.name { font-weight: 600; display: flex; align-items: center; gap: var(--sp-2); }
	.muted { color: var(--muted-foreground); font-size: 12px; }
	.empty { text-align: center; color: var(--muted-foreground); padding: var(--sp-8); }

	.tag { font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 4px; background: var(--primary-subtle); color: var(--primary-subtle-foreground); }
	.tag--me { background: var(--muted); color: var(--muted-foreground); }
	.tag--plain { background: var(--muted); color: var(--muted-foreground); }
	.role-select { min-width: 120px; padding-top: 4px; padding-bottom: 4px; font-size: 13px; }

	.status { font-size: 12px; font-weight: 500; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
	.status[data-status='active'] { background: var(--success-subtle); color: var(--success); }
	.status[data-status='invited'] { background: var(--secondary-subtle); color: var(--secondary-foreground); }
	.status[data-status='placeholder'] { background: var(--muted); color: var(--muted-foreground); }
	.status[data-status='deactivated'] { background: var(--danger-subtle); color: var(--danger); }

	.actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--sp-2); }
	.transfer { border: 1px solid var(--border); border-radius: var(--radius); padding: var(--sp-4) var(--sp-5); margin-bottom: var(--sp-4); display: flex; flex-direction: column; gap: var(--sp-2); }
	.transfer h2 { font-size: 15px; font-weight: 700; margin: 0; }
	.transfer-head { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--sp-4); flex-wrap: wrap; }
	.transfer-form { display: flex; flex-direction: column; gap: var(--sp-3); max-width: 640px; }
	.transfer-form fieldset { border: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--sp-1); }
	.transfer-form legend { font-size: 13px; font-weight: 500; margin-bottom: var(--sp-1); }
	.radio { display: flex; gap: var(--sp-2); align-items: baseline; font-size: 13px; }
	.confirm-row { display: grid; grid-template-columns: 1fr 160px auto; gap: var(--sp-3); align-items: end; }
	@media (max-width: 640px) { .confirm-row { grid-template-columns: 1fr; } }
	.row { display: flex; gap: var(--sp-2); }
	.muted { margin: 0; }
</style>
