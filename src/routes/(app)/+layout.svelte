<script lang="ts">
	import type { LayoutProps } from './$types';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import Tour from '#lib/components/Tour.svelte';
	import TaskDrawer from '#lib/components/TaskDrawer.svelte';
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

	// Account menu (spec: everyone can change their own display name, whatever their role).
	let accountOpen = $state(false);
	let myName = $state('');
	let nameMsg = $state<{ ok: boolean; text: string } | null>(null);
	let savingName = $state(false);
	function toggleAccount() {
		accountOpen = !accountOpen;
		myName = data.me?.displayName ?? '';
		nameMsg = null;
	}
	async function saveName(e: SubmitEvent) {
		e.preventDefault();
		savingName = true;
		const res = await fetch('/api/me', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: myName.trim() }) });
		savingName = false;
		const body = await res.json().catch(() => ({}));
		nameMsg = res.ok ? { ok: true, text: 'Name saved.' } : { ok: false, text: body.message ?? 'That name could not be saved.' };
		if (res.ok) await invalidateAll();
	}
	function onAccountKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && accountOpen) accountOpen = false;
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
		{#if data.isAdmin}<span class="admin-links" data-tour="admin-links"><a href="/templates" aria-current={cur('/templates')}>Templates</a><a href="/settings/people" aria-current={cur('/settings/people')}>People</a>{#if data.systemRole === 'admin'}<a href="/settings/calendar" aria-current={cur('/settings/calendar')}>Calendar</a>{/if}</span>{/if}
	</div>
	{#if data.user}
		<div class="nav-user">
			<button class="btn btn-ghost" data-tour="tour-button" onclick={() => (touring = true)} title="A short walk through the app">Tour</button>
			<div class="account">
				<button class="btn btn-ghost" onclick={toggleAccount} aria-expanded={accountOpen} aria-haspopup="true">
					{data.me?.displayName ?? data.user.name}{#if data.systemRole !== 'member'}<span class="role-tag">{data.systemRole === 'admin' ? 'Admin' : 'Manager'}</span>{/if}
				</button>
				{#if accountOpen}
					<form class="account-menu" onsubmit={saveName}>
						<label class="field">
							<span>Your display name</span>
							<!-- svelte-ignore a11y_autofocus -->
							<input class="input" bind:value={myName} maxlength="80" required autofocus />
						</label>
						<p class="hint">How you appear on tasks, comments and the activity log.</p>
						{#if nameMsg}<p class="notice" class:notice--ok={nameMsg.ok} class:notice--error={!nameMsg.ok} role="status">{nameMsg.text}</p>{/if}
						<div class="row">
							<button class="btn btn-primary" disabled={savingName || !myName.trim()}>Save</button>
							<button type="button" class="btn btn-ghost" onclick={() => (accountOpen = false)}>Close</button>
						</div>
					</form>
				{/if}
			</div>
			<button class="btn btn-ghost" onclick={signOut}>Sign out</button>
		</div>
	{/if}
</nav>

{@render children()}

<svelte:window onkeydown={onAccountKey} />
<TaskDrawer />
<Tour steps={tourSteps} ctx={tourCtx} bind:open={touring} onend={endTour} />

<style>
	.logo { text-decoration: none; }
	.admin-links { display: flex; gap: var(--sp-4); }
	.account { position: relative; }
	.role-tag { margin-left: var(--sp-2); font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 4px; background: var(--primary-subtle); color: var(--primary-subtle-foreground); }
	.account-menu {
		position: absolute; right: 0; top: calc(100% + 6px); z-index: 800; width: 280px;
		background: var(--background); border: 1px solid var(--border); border-radius: var(--radius);
		box-shadow: 0 8px 24px rgba(15, 23, 42, 0.15); padding: var(--sp-3) var(--sp-4);
		display: flex; flex-direction: column; gap: var(--sp-2); color: var(--foreground);
	}
	.account-menu .hint { font-size: 12px; color: var(--muted-foreground); margin: 0; }
	.account-menu .row { display: flex; gap: var(--sp-2); }
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
