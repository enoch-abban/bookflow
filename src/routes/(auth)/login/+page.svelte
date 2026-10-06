<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let busy = $state(false);

	const step = $derived(form?.step ?? (data.pendingEmail ? 'code' : 'password'));
	const email = $derived(form?.email || data.pendingEmail || '');

	const submit = () => {
		busy = true;
		return async ({ update }: { update: () => Promise<void> }) => {
			await update();
			busy = false;
		};
	};
</script>

<svelte:head><title>Sign in · bookflow</title></svelte:head>

{#if step === 'code'}
	<div>
		<h1>Check your email</h1>
		<p class="lede">We sent a 6-digit code to <strong>{email}</strong>. It expires in 10 minutes.</p>
	</div>

	<form method="POST" action="?/code" use:enhance={submit}>
		<label class="field">
			<span>Sign-in code</span>
			<!-- svelte-ignore a11y_autofocus -->
			<input class="input input--code" name="code" inputmode="numeric" autocomplete="one-time-code"
				pattern="[0-9 ]*" maxlength="7" required autofocus />
		</label>
		{#if form?.message}<p class="notice notice--error" role="alert">{form.message}</p>{/if}
		{#if form && 'sent' in form && form.sent}<p class="notice notice--ok">A new code is on its way.</p>{/if}
		<button class="btn btn-primary btn-lg" disabled={busy}>Sign in</button>
	</form>

	<div class="row-between">
		<form method="POST" action="?/resend" use:enhance={submit}>
			<button class="btn-link" disabled={busy}>Send a new code</button>
		</form>
		<form method="POST" action="?/restart" use:enhance={submit}>
			<button class="btn-link">Use a different account</button>
		</form>
	</div>
{:else}
	<div>
		<h1>Sign in</h1>
		<p class="lede">You'll also get a code by email to confirm it's you.</p>
	</div>

	{#if data.notice}<p class="notice notice--ok">{data.notice}</p>{/if}

	<form method="POST" action="?/password" use:enhance={submit}>
		<label class="field">
			<span>Email</span>
			<input class="input" type="email" name="email" autocomplete="username" value={email} required />
		</label>
		<label class="field">
			<span class="row-between">Password <a href="/reset-password" class="hint">Forgot password?</a></span>
			<input class="input" type="password" name="password" autocomplete="current-password" required />
		</label>
		{#if form?.message}<p class="notice notice--error" role="alert">{form.message}</p>{/if}
		<button class="btn btn-primary btn-lg" disabled={busy}>Continue</button>
	</form>

	<p class="foot">bookflow is invite-only. Ask your coordinator for an invite.</p>
{/if}
