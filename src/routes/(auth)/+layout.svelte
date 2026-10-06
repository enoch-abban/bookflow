<script lang="ts">
	import type { LayoutProps } from './$types';
	let { children }: LayoutProps = $props();
</script>

<main class="auth-shell">
	<div class="auth-card">
		<a href="/" class="auth-logo">bookflow</a>
		{@render children()}
	</div>
</main>

<style>
	.auth-shell {
		min-height: 100%;
		display: flex; align-items: flex-start; justify-content: center;
		padding: 12vh var(--sp-4) var(--sp-8);
		background: var(--muted);
	}
	.auth-card {
		width: 100%; max-width: 380px;
		background: var(--background);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: var(--sp-8) var(--sp-6);
		display: flex; flex-direction: column; gap: var(--sp-5);
	}
	.auth-logo { font-size: 18px; font-weight: 700; letter-spacing: -0.02em; }
	.auth-logo:hover { text-decoration: none; }
	.auth-card :global(h1) { font-size: 20px; font-weight: 700; }
	.auth-card :global(.lede) { margin: var(--sp-1) 0 0; color: var(--muted-foreground); font-size: 13px; }
	.auth-card :global(form) { display: flex; flex-direction: column; gap: var(--sp-4); }
	.auth-card :global(.row-between) { display: flex; justify-content: space-between; align-items: center; gap: var(--sp-3); }
	.auth-card :global(.foot) { font-size: 13px; color: var(--muted-foreground); text-align: center; margin: 0; }
</style>
