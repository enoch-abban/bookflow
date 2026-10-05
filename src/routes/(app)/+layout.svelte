<script lang="ts">
	import type { LayoutProps } from './$types';
	let { children, data }: LayoutProps = $props();
</script>

<nav class="app-nav">
	<span class="logo">bookflow</span>
	{#if data.seriesId}
		<div class="nav-links">
			<a href="/s/{data.seriesId}">Matrix</a>
			<a href="/s/{data.seriesId}/swimlane">Swimlane</a>
			<a href="/me">My tasks</a>
		</div>
	{/if}
</nav>

{@render children()}
