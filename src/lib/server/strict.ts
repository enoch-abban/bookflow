/**
 * Strict mode on the server (spec: Swimlane editor): run the check on a change's planned
 * result and, when the series is strict and the change would leave a task starting too
 * early, refuse it with 422 predecessor_conflict, naming the predecessors and any started
 * task that stopped the push.
 */
import { json } from '@sveltejs/kit';
import { strictConflicts, type Conflict, type Plan } from '#lib/schedule/strict.ts';
import { shortDate } from '#lib/notifications/messages.ts';
import type { SeriesContext } from './series-context.ts';

const list = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/** The refusal's wording for one conflict. */
export function describeConflict(c: Conflict, label: (id: string) => string): string {
	const preds = list(c.predecessorIds.map(label));
	return c.frozen
		? `${label(c.taskId)} has started, so it cannot be pushed, and would start before ${preds} allows (${shortDate(c.earliest)}). Finish or reset it, or turn strict mode off.`
		: `${label(c.taskId)} cannot start before ${shortDate(c.earliest)}, after ${preds}.`;
}

/**
 * The 422 response when a strict series' change would cause a conflict, or null to go ahead.
 * @param always the tasks the change moves on purpose: they may not end in conflict at all.
 */
export function strictRefusal(ctx: Pick<SeriesContext, 'series' | 'labels'>, before: Plan, after: Plan, always: Iterable<string> = []): Response | null {
	if (!ctx.series.strictMode) return null;
	const conflicts = strictConflicts(before, after, always);
	if (!conflicts.length) return null;
	const label = (id: string) => ctx.labels.get(id) ?? 'A task';
	// A started task that stopped the push is the one to act on, so it leads.
	const ordered = [...conflicts.filter((c) => c.frozen), ...conflicts.filter((c) => !c.frozen)];
	const more = ordered.length > 1 ? ` ${ordered.length - 1} more ${ordered.length === 2 ? 'task is' : 'tasks are'} affected.` : '';
	return json({
		error: 'predecessor_conflict',
		message: `Strict mode: ${describeConflict(ordered[0], label)}${more}`,
		taskIds: ordered.map((c) => c.taskId),
		conflicts: ordered.map((c) => ({
			taskId: c.taskId, label: label(c.taskId), earliest: c.earliest, days: c.days, started: c.frozen,
			predecessors: c.predecessorIds.map((id) => ({ id, label: label(id), endDate: after.taskMap.get(id)?.endDate ?? null }))
		}))
	}, { status: 422 });
}
