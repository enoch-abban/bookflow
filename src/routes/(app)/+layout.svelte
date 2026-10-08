<script lang="ts">
	import type { LayoutProps } from './$types';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import Tour from '#lib/components/Tour.svelte';
	import { stepsFor } from '#lib/tour/steps.ts';
	let { children, data }: LayoutProps = $props();

	// Guided tour: starts by itself on a person's first visit, replays from the Tour button.
	let touring = $state(false);
	const tourCtx = $derived({ seriesId: data.seriesId, role: data.role, seriesCount: data.seriesList.length });
	const tourSteps = $derived(stepsFor(tourCtx));
	onMount(() => {
		if (!data.tourDone && data.user) setTimeout(() => (touring = true), 600);
	});
	function endTour() {
		fetch('/api/me/tour', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ done: true }) }).catch(() => {});
	}

	// Switching series keeps you on the same kind of page (matrix, swimlane, settings…).
	function switchSeries(id: string) {
		if (id === '__new') return goto('/series/new');
		const rest = page.params.series ? page.url.pathname.split('/').slice(3).join('/') : '';
		const keep = rest && !rest.startsWith('books/') ? `/${rest}` : '';
		goto(`/s/${id}${keep}`);
	}

	// Which nav link is "you are here". Book pages live under the Matrix.
	function isCurrent(href: string) {
		const path = page.url.pathname;
		if (href === `/s/${data.seriesId}`) return path === href || path.startsWith(`${href}/books/`);
		return path === href || path.startsWith(`${href}/`);
	}
	const cur = (href: string) => (isCurrent(href) ? 'page' : undefined);

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
		<select data-tour="series-switch" class="series-switch" aria-label="Series" value={data.seriesId} onchange={(e) => switchSeries(e.currentTarget.value)}>
			{#each data.seriesList as s (s.id)}<option value={s.id}>{s.name}{s.status === 'closed' ? ' (closed)' : ''}</option>{/each}
			{#if data.isAdmin}<option value="__new">+ New series…</option>{/if}
		</select>
	{/if}
	<div class="nav-links">
		{#if data.seriesId}
			<a href="/s/{data.seriesId}" aria-current={cur(`/s/${data.seriesId}`)}>Matrix</a>
			<a href="/s/{data.seriesId}/swimlane" aria-current={cur(`/s/${data.seriesId}/swimlane`)}>Swimlane</a>
			<a href="/s/{data.seriesId}/workload" aria-current={cur(`/s/${data.seriesId}/workload`)}>Workload</a>
		{/if}
		<a href="/me" aria-current={cur('/me')}>My tasks</a>
		{#if data.seriesId && data.canManageSeries}<a href="/s/{data.seriesId}/baselines" aria-current={cur(`/s/${data.seriesId}/baselines`)}>Baselines</a><a href="/s/{data.seriesId}/activity" aria-current={cur(`/s/${data.seriesId}/activity`)}>Activity</a><a href="/s/{data.seriesId}/settings" aria-current={cur(`/s/${data.seriesId}/settings`)}>Settings</a>{/if}
		{#if data.isAdmin}<span class="admin-links" data-tour="admin-links"><a href="/templates" aria-current={cur('/templates')}>Templates</a><a href="/settings/people" aria-current={cur('/settings/people')}>People</a><a href="/settings/calendar" aria-current={cur('/settings/calendar')}>Calendar</a></span>{/if}
	</div>
	{#if data.user}
		<div class="nav-user">
			<button class="btn btn-ghost" data-tour="tour-button" onclick={() => (touring = true)} title="A short walk through the app">Tour</button>
			<span>{data.user.name}</span>
			<button class="btn btn-ghost" onclick={signOut}>Sign out</button>
		</div>
	{/if}
</nav>

{@render children()}

<Tour steps={tourSteps} ctx={tourCtx} bind:open={touring} onend={endTour} />

<style>
	.logo { text-decoration: none; }
	.admin-links { display: flex; gap: var(--sp-4); }
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
