<script lang="ts">
	import type { LayoutProps } from './$types';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	let { children, data }: LayoutProps = $props();

	// Switching series keeps you on the same kind of page (matrix, swimlane, settings…).
	function switchSeries(id: string) {
		if (id === '__new') return goto('/series/new');
		const rest = page.params.series ? page.url.pathname.split('/').slice(3).join('/') : '';
		const keep = rest && !rest.startsWith('books/') ? `/${rest}` : '';
		goto(`/s/${id}${keep}`);
	}

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
	<a class="logo" href="/">bookflow</a>
	{#if data.seriesList.length > 1 || (data.isAdmin && data.seriesList.length)}
		<select class="series-switch" aria-label="Series" value={data.seriesId} onchange={(e) => switchSeries(e.currentTarget.value)}>
			{#each data.seriesList as s (s.id)}<option value={s.id}>{s.name}{s.status === 'closed' ? ' (closed)' : ''}</option>{/each}
			{#if data.isAdmin}<option value="__new">+ New series…</option>{/if}
		</select>
	{/if}
	<div class="nav-links">
		{#if data.seriesId}
			<a href="/s/{data.seriesId}">Matrix</a>
			<a href="/s/{data.seriesId}/swimlane">Swimlane</a>
			<a href="/s/{data.seriesId}/workload">Workload</a>
		{/if}
		<a href="/me">My tasks</a>
		{#if data.seriesId && data.canManageSeries}<a href="/s/{data.seriesId}/baselines">Baselines</a><a href="/s/{data.seriesId}/activity">Activity</a><a href="/s/{data.seriesId}/settings">Settings</a>{/if}
		{#if data.isAdmin}<a href="/templates">Templates</a><a href="/settings/people">People</a><a href="/settings/calendar">Calendar</a>{/if}
	</div>
	{#if data.user}
		<div class="nav-user">
			<span>{data.user.name}</span>
			<button class="btn btn-ghost" onclick={signOut}>Sign out</button>
		</div>
	{/if}
</nav>

{@render children()}

<style>
	.logo { text-decoration: none; }
	.series-switch {
		font: inherit; font-size: 13px; font-weight: 600;
		border: 1px solid var(--border); border-radius: var(--radius-sm);
		padding: 4px 8px; background: var(--background); color: var(--foreground);
		max-width: 200px;
	}
	.nav-user {
		margin-left: auto;
		display: flex; align-items: center; gap: var(--sp-3);
		font-size: 13px; color: var(--muted-foreground);
	}
</style>
