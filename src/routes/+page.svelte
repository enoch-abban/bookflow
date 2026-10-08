<script lang="ts">
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
</script>

<main class="welcome">
	<h1>Welcome, {data.name}</h1>
	<p>You have not been added to a series yet. Your coordinator will add you, and your tasks will appear under My tasks.</p>
	<a class="btn btn-ghost" href="/me">My tasks</a>
</main>

<style>
	.welcome { max-width: 520px; margin: 15vh auto; padding: var(--sp-6); text-align: center; display: flex; flex-direction: column; gap: var(--sp-4); align-items: center; }
	.welcome h1 { font-size: 22px; font-weight: 700; }
	.welcome p { color: var(--muted-foreground); }
</style>
