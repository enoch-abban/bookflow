<script lang="ts">
	import type { PageProps } from './$types';
	import { enhance } from '$app/forms';

	let { data, form }: PageProps = $props();
	let returning = $state<string | null>(null);

	function fmtDate(d: string): string {
		const [yr, mm, day] = d.split('-');
		return `${['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+mm]} ${+day}, ${yr}`;
	}

	const STATUS_LABEL: Record<string, string> = {
		not_started: 'Not started',
		in_progress: 'In progress',
		in_review:   'In review',
		returned:    'Returned',
		blocked:     'Blocked',
	};
</script>

<div class="me-page">
	<header class="page-header">
		<h1>My tasks</h1>
		{#if data.person}
			<span class="person-name">{data.person.displayName}</span>
		{/if}
	</header>

	{#if form?.message}<p class="notice notice--error" role="alert">{form.message}</p>{/if}

	{#if data.reviews.length}
		<section class="task-group" data-tour="my-tasks">
			<h2 class="group-heading">Waiting for my review <span class="group-count">{data.reviews.length}</span></h2>
			<div class="task-list">
				{#each data.reviews as r (r.taskId)}
					<div class="task-row review-row" data-status="in_review">
						<div class="task-info">
							<div class="task-title">
								<span class="task-book">{r.bookCode}</span>
								<span class="task-stage">{r.stageName}</span>
								<span class="iter-badge">round {r.iteration}</span>
							</div>
							<div class="task-meta">
								<a href="/s/{r.seriesId}/books/{encodeURIComponent(r.bookCode)}" class="series-link">{r.seriesName}</a>
								<span class="task-due">Planned to end {fmtDate(r.endDate)}</span>
								{#if r.feedbackUrl}<a href={r.feedbackUrl} target="_blank" rel="noopener" class="series-link">Feedback file</a>{/if}
							</div>
						</div>
						<div class="task-actions review-actions">
							<form method="POST" action="?/approve" use:enhance>
								<input type="hidden" name="taskId" value={r.taskId} />
								<button type="submit" class="btn btn-primary">Approve</button>
							</form>
							{#if returning === r.taskId}
								<form method="POST" action="?/return" class="return-form" use:enhance={() => async ({ update }) => { await update(); returning = null; }}>
									<input type="hidden" name="taskId" value={r.taskId} />
									<!-- svelte-ignore a11y_autofocus -->
									<input class="input" name="summary" maxlength="1000" required autofocus placeholder="What needs changing (detail stays in the Drive file)" />
									<button type="submit" class="btn btn-secondary">Return</button>
									<button type="button" class="btn btn-ghost" onclick={() => (returning = null)}>Cancel</button>
								</form>
							{:else}
								<button class="btn btn-ghost" onclick={() => (returning = r.taskId)}>Return with changes</button>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	{#if !data.person}
		<div class="empty-state" data-tour="my-tasks">
			<p>Your account is not yet linked to a team member. Ask your coordinator to invite you.</p>
		</div>
	{:else if data.groups.length === 0}
		<div class="empty-state" data-tour="my-tasks">
			<p>No open tasks assigned to you. You're all caught up!</p>
		</div>
	{:else}
		{#each data.groups as group (group.label)}
			<section class="task-group" data-tour="my-tasks" class:urgent={group.urgent}>
				<h2 class="group-heading">{group.label} <span class="group-count">{group.rows.length}</span></h2>
				<div class="task-list">
					{#each group.rows as row (row.taskId)}
						<div class="task-row" data-status={row.status}>
							<div class="task-info">
								<div class="task-title">
									<span class="task-book">{row.bookCode}</span>
									<span class="task-stage">{row.stageName}</span>
									{#if row.iteration > 1}
										<span class="iter-badge">×{row.iteration}</span>
									{/if}
								</div>
								<div class="task-meta">
									<a href="/s/{row.seriesId}" class="series-link">{row.seriesName}</a>
									<span class="task-due">Due {fmtDate(row.dueDate ?? row.endDate)}</span>
									<span class="chip chip--inline" data-status={row.status}>
										{STATUS_LABEL[row.status] ?? row.status}
									</span>
								</div>
							</div>
							<div class="task-actions">
								{#if row.status === 'not_started'}
									<form method="POST" action="?/start" use:enhance>
										<input type="hidden" name="taskId" value={row.taskId} />
										<button type="submit" class="btn btn-primary">Start</button>
									</form>
								{:else if row.status === 'in_progress'}
									{#if row.reviewed}
										<form method="POST" action="?/submit" use:enhance>
											<input type="hidden" name="taskId" value={row.taskId} />
											<button type="submit" class="btn btn-secondary">Submit for review</button>
										</form>
									{:else}
										<form method="POST" action="?/done" use:enhance>
											<input type="hidden" name="taskId" value={row.taskId} />
											<button type="submit" class="btn btn-primary">Done</button>
										</form>
									{/if}
								{:else if row.status === 'in_review'}
									<span class="waiting">Waiting on {row.waitingOn.length ? row.waitingOn.join(', ') : 'a coordinator'}</span>
								{:else if row.status === 'returned'}
									<form method="POST" action="?/resume" use:enhance>
										<input type="hidden" name="taskId" value={row.taskId} />
										<button type="submit" class="btn btn-primary">Resume corrections</button>
									</form>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</section>
		{/each}
	{/if}
</div>

<style>
	.me-page { max-width: 800px; margin: 0 auto; padding: var(--sp-6); }

	.page-header {
		display: flex; align-items: baseline; gap: var(--sp-4);
		margin-bottom: var(--sp-6);
	}
	.page-header h1 { font-size: 22px; font-weight: 700; }
	.person-name { font-size: 14px; color: var(--muted-foreground); }

	.empty-state {
		padding: var(--sp-8);
		text-align: center;
		color: var(--muted-foreground);
		background: var(--muted);
		border-radius: var(--radius);
	}

	.task-group { margin-bottom: var(--sp-8); }
	.group-heading {
		font-size: 13px; font-weight: 700; text-transform: uppercase;
		letter-spacing: 0.06em; color: var(--muted-foreground);
		margin-bottom: var(--sp-3);
		display: flex; align-items: center; gap: var(--sp-2);
	}
	.urgent .group-heading { color: var(--danger); }
	.group-count {
		display: inline-flex; align-items: center; justify-content: center;
		width: 20px; height: 20px; border-radius: 50%;
		background: var(--muted); color: var(--muted-foreground);
		font-size: 11px;
	}
	.urgent .group-count { background: var(--danger-subtle); color: var(--danger); }

	.task-list { display: flex; flex-direction: column; gap: var(--sp-2); }

	.task-row {
		display: flex; align-items: center; justify-content: space-between;
		gap: var(--sp-4);
		padding: var(--sp-3) var(--sp-4);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--background);
	}
	.task-row:hover { border-color: var(--primary); }
	.task-row[data-status="returned"] { border-left: 3px solid var(--tertiary); }
	.task-row[data-status="blocked"]  { border-left: 3px solid var(--danger); }

	.task-info { flex: 1; min-width: 0; }
	.task-title {
		display: flex; align-items: center; gap: var(--sp-2);
		margin-bottom: var(--sp-1);
	}
	.task-book  { font-weight: 700; font-size: 14px; }
	.task-stage { font-size: 14px; color: var(--muted-foreground); }
	.iter-badge {
		font-size: 11px; font-weight: 700;
		background: var(--tertiary-subtle); color: var(--tertiary-foreground);
		padding: 1px 5px; border-radius: 4px;
	}

	.task-meta {
		display: flex; align-items: center; gap: var(--sp-3);
		font-size: 12px; color: var(--muted-foreground);
	}
	.series-link { color: var(--primary); }
	.series-link:hover { text-decoration: underline; }

	.chip--inline {
		padding: 1px 6px; border-radius: 4px; font-size: 11px; font-weight: 500;
		min-height: auto;
	}

	.task-actions { display: flex; gap: var(--sp-2); flex-shrink: 0; }
	.review-actions { flex-wrap: wrap; justify-content: flex-end; max-width: 60%; }
	.return-form { display: flex; gap: var(--sp-2); flex-wrap: wrap; }
	.return-form .input { min-width: 240px; }
	.review-row { border-left: 3px solid var(--secondary); }
	.waiting { font-size: 12px; color: var(--muted-foreground); }

	/* Buttons */
	.btn {
		padding: var(--sp-1) var(--sp-3);
		border-radius: var(--radius-sm);
		border: 1px solid transparent;
		font-size: 13px; font-weight: 500;
		white-space: nowrap;
		transition: background 0.1s;
	}
	.btn-primary {
		background: var(--primary); color: var(--primary-foreground); border-color: var(--primary);
	}
	.btn-primary:hover { background: var(--primary-hover); border-color: var(--primary-hover); }
	.btn-secondary {
		background: var(--secondary-subtle); color: var(--secondary-foreground); border-color: var(--secondary);
	}
	.btn-secondary:hover { background: var(--secondary); color: var(--secondary-foreground); }
	.btn-ghost {
		background: transparent; color: var(--muted-foreground); border-color: var(--border);
	}
	.btn-ghost:hover { background: var(--muted); color: var(--foreground); }
</style>
