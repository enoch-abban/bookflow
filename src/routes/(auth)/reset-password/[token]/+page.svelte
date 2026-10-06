<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let busy = $state(false);
</script>

<svelte:head><title>Choose a new password · bookflow</title></svelte:head>

<div>
	<h1>Choose a new password</h1>
	<p class="lede">You'll be signed out on every other device.</p>
</div>

{#if !data.valid}
	<p class="notice notice--error">This reset link has expired or was already used.</p>
	<a class="btn btn-primary btn-lg" href="/reset-password" style="text-align:center">Request a new link</a>
{:else}
	<form method="POST" use:enhance={() => {
		busy = true;
		return async ({ update }) => { await update(); busy = false; };
	}}>
		<label class="field">
			<span>New password <span class="hint">at least 10 characters</span></span>
			<!-- svelte-ignore a11y_autofocus -->
			<input class="input" type="password" name="password" autocomplete="new-password" minlength="10" maxlength="128" required autofocus />
		</label>
		<label class="field">
			<span>Confirm new password</span>
			<input class="input" type="password" name="confirm" autocomplete="new-password" minlength="10" maxlength="128" required />
		</label>
		{#if form?.message}<p class="notice notice--error" role="alert">{form.message}</p>{/if}
		<button class="btn btn-primary btn-lg" disabled={busy}>Save password</button>
	</form>
{/if}
