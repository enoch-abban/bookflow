<script lang="ts">
	import type { PageProps } from './$types';
	import { invalidateAll } from '$app/navigation';
	import { api } from '#lib/api-client.ts';

	let { data }: PageProps = $props();
	let busy = $state(false);
	let done = $state<{ ok: boolean; text: string } | null>(null);

	const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

	async function accept() {
		if (data.state !== 'pending') return;
		busy = true;
		const res = await api('POST', '/api/admin-transfers/accept', { token: data.token });
		busy = false;
		done = res.ok ? { ok: true, text: `You are now the bookflow admin. ${data.from} is now ${data.senderBecomes}.` } : { ok: false, text: res.message };
		await invalidateAll();
	}
	async function decline() {
		if (data.state !== 'pending') return;
		busy = true;
		const res = await api('DELETE', `/api/admin-transfers/${data.id}`);
		busy = false;
		done = res.ok ? { ok: true, text: `You declined. ${data.from} is still the admin and has been told.` } : { ok: false, text: res.message };
		await invalidateAll();
	}
</script>

<svelte:head><title>Admin role transfer · bookflow</title></svelte:head>

<main class="transfer">
	<h1>Admin role transfer</h1>
	{#if done}
		<p class="notice" class:notice--ok={done.ok} class:notice--error={!done.ok} role="status">{done.text}</p>
		<a class="btn btn-ghost" href="/">Go to bookflow</a>
	{:else if data.state === 'invalid'}
		<p>This link is not valid. Check that you opened the whole link from the email.</p>
	{:else if data.state === 'accepted'}
		<p>This transfer was already accepted: {data.to} is the admin.</p>
	{:else if data.state === 'cancelled'}
		<p>This transfer is no longer open: it was cancelled, declined, or it expired. Nothing changed.</p>
	{:else if !data.isRecipient}
		<p>This transfer is for <strong>{data.to}</strong>. {data.isSender ? 'You started it; it waits for them to accept.' : 'Sign in as them to accept it.'}</p>
	{:else}
		<p><strong>{data.from}</strong> wants to hand you the bookflow admin role.</p>
		<ul>
			<li>You will be able to do everything across all series, including granting the admin and manager roles, deactivating anyone, and managing holidays.</li>
			<li>{data.from} will become <strong>{data.senderBecomes}</strong>.</li>
			<li>Your series roles stay as they are.</li>
		</ul>
		<p class="muted">Nothing changes unless you accept. This link expires on {fmt(data.expiresAt)}.</p>
		<div class="row">
			<button class="btn btn-primary btn-lg" disabled={busy} onclick={accept}>Accept the admin role</button>
			<button class="btn btn-ghost btn-lg" disabled={busy} onclick={decline}>Decline</button>
		</div>
	{/if}
</main>

<style>
	.transfer { max-width: 560px; margin: 10vh auto; padding: var(--sp-6); display: flex; flex-direction: column; gap: var(--sp-3); }
	h1 { font-size: 22px; font-weight: 700; }
	ul { margin: 0; padding-left: var(--sp-5); display: flex; flex-direction: column; gap: var(--sp-1); font-size: 14px; }
	.muted { color: var(--muted-foreground); font-size: 13px; }
	.row { display: flex; gap: var(--sp-2); flex-wrap: wrap; }
</style>
