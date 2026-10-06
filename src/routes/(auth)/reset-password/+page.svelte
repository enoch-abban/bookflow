<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
	let busy = $state(false);
</script>

<svelte:head><title>Reset password · bookflow</title></svelte:head>

<div>
	<h1>Reset your password</h1>
	<p class="lede">Enter your email and we'll send you a link to choose a new password.</p>
</div>

{#if form && 'sent' in form}
	<p class="notice notice--ok">
		If an account exists for <strong>{form.email}</strong>, a reset link is on its way. It expires in 30 minutes.
	</p>
{:else}
	<form method="POST" use:enhance={() => {
		busy = true;
		return async ({ update }) => { await update(); busy = false; };
	}}>
		<label class="field">
			<span>Email</span>
			<input class="input" type="email" name="email" autocomplete="username" value={form?.email ?? ''} required />
		</label>
		{#if form?.message}<p class="notice notice--error" role="alert">{form.message}</p>{/if}
		<button class="btn btn-primary btn-lg" disabled={busy}>Send reset link</button>
	</form>
{/if}

<p class="foot"><a href="/login">Back to sign in</a></p>
