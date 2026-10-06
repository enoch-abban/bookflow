<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let busy = $state(false);

	const step = $derived(form?.step ?? (data.awaitingCode ? 'code' : 'details'));

	const submit = () => {
		busy = true;
		return async ({ update }: { update: () => Promise<void> }) => {
			await update();
			busy = false;
		};
	};
</script>

<svelte:head><title>Accept invite · bookflow</title></svelte:head>

{#if step === 'code'}
	<div>
		<h1>Confirm your email</h1>
		<p class="lede">We sent a 6-digit code to <strong>{data.email}</strong>. Enter it to finish setting up your account.</p>
	</div>

	<form method="POST" action="?/code" use:enhance={submit}>
		<label class="field">
			<span>Verification code</span>
			<!-- svelte-ignore a11y_autofocus -->
			<input class="input input--code" name="code" inputmode="numeric" autocomplete="one-time-code"
				pattern="[0-9 ]*" maxlength="7" required autofocus />
		</label>
		{#if form?.message}<p class="notice notice--error" role="alert">{form.message}</p>{/if}
		{#if form && 'sent' in form && form.sent}<p class="notice notice--ok">A new code is on its way.</p>{/if}
		<button class="btn btn-primary btn-lg" disabled={busy}>Finish</button>
	</form>

	<div class="row-between">
		<form method="POST" action="?/resend" use:enhance={submit}>
			<button class="btn-link" disabled={busy}>Send a new code</button>
		</form>
		<form method="POST" action="?/restart" use:enhance={submit}>
			<button class="btn-link">Change name or password</button>
		</form>
	</div>
{:else}
	<div>
		<h1>Set up your account</h1>
		<p class="lede">You've been invited as <strong>{data.email}</strong>.</p>
	</div>

	<form method="POST" action="?/details" use:enhance={submit}>
		<label class="field">
			<span>Display name <span class="hint">shown to your team</span></span>
			<input class="input" name="displayName" autocomplete="name" maxlength="80" required
				value={form?.displayName ?? data.displayName} />
		</label>
		<label class="field">
			<span>Password <span class="hint">at least 10 characters</span></span>
			<input class="input" type="password" name="password" autocomplete="new-password" minlength="10" maxlength="128" required />
		</label>
		<label class="field">
			<span>Confirm password</span>
			<input class="input" type="password" name="confirm" autocomplete="new-password" minlength="10" maxlength="128" required />
		</label>
		{#if form?.message}<p class="notice notice--error" role="alert">{form.message}</p>{/if}
		<button class="btn btn-primary btn-lg" disabled={busy}>Continue</button>
	</form>
{/if}
