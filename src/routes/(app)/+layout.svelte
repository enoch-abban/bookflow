<script lang="ts">
	import type { LayoutProps } from './$types';
	import { goto } from '$app/navigation';
	let { children, data }: LayoutProps = $props();

	async function signOut() {
		await fetch('/api/auth/sign-out', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}'
		});
		await goto('/login', { invalidateAll: true });
	}
</script>

<nav class="app-nav">
	<span class="logo">bookflow</span>
	{#if data.seriesId}
		<div class="nav-links">
			<a href="/s/{data.seriesId}">Matrix</a>
			<a href="/s/{data.seriesId}/swimlane">Swimlane</a>
			<a href="/me">My tasks</a>
			{#if data.isAdmin}<a href="/settings/people">People</a>{/if}
		</div>
	{/if}
	{#if data.user}
		<div class="nav-user">
			<span>{data.user.name}</span>
			<button class="btn btn-ghost" onclick={signOut}>Sign out</button>
		</div>
	{/if}
</nav>

{@render children()}

<style>
	.nav-user {
		margin-left: auto;
		display: flex; align-items: center; gap: var(--sp-3);
		font-size: 13px; color: var(--muted-foreground);
	}
</style>
