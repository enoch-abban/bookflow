/**
 * Strict mode on the server (spec: Swimlane editor): run the check on a change's planned
 * result and, when the series is strict and the change would leave a task starting too
 * early, refuse it with 422 predecessor_conflict, naming the predecessors and any started
 * task that stopped the push.
 */
import { error, json } from '@sveltejs/kit';
import { strictConflicts, type Conflict, type Plan } from '#lib/schedule/strict.ts';
import { shortDate } from '#lib/notifications/messages.ts';

const list = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/** The refusal's wording for one conflict. */
export function describeConflict(c: Conflict, label: (id: string) => string): string {
	const preds = list(c.predecessorIds.map(label));
	return c.frozen
		? `${label(c.taskId)} has started, so it cannot be pushed, and would start before ${preds} allows (${shortDate(c.earliest)}). Finish or reset it, or turn strict mode off.`
		: `${label(c.taskId)} cannot start before ${shortDate(c.earliest)}, after ${preds}.`;
}

type Ctx = { series: { strictMode: number }; labels: Map<string, string> };

/** The refusal's body, or null when the change may go ahead. */
function refusal(ctx: Ctx, before: Plan, after: Plan, always: Iterable<string>) {
	if (!ctx.series.strictMode) return null;
	const conflicts = strictConflicts(before, after, always);
	if (!conflicts.length) return null;
	const label = (id: string) => ctx.labels.get(id) ?? 'A task';
	// A started task that stopped the push is the one to act on, so it leads.
	const ordered = [...conflicts.filter((c) => c.frozen), ...conflicts.filter((c) => !c.frozen)];
	const more = ordered.length > 1 ? ` ${ordered.length - 1} more ${ordered.length === 2 ? 'task is' : 'tasks are'} affected.` : '';
	return {
		error: 'predecessor_conflict',
		message: `Strict mode: ${describeConflict(ordered[0], label)}${more}`,
		taskIds: ordered.map((c) => c.taskId),
		conflicts: details(ordered, after, label)
	};
}

/** Conflicts as responses and previews list them. */
function details(conflicts: Conflict[], after: Plan, label: (id: string) => string) {
	return conflicts.map((c) => ({
		taskId: c.taskId, label: label(c.taskId), earliest: c.earliest, days: c.days, started: c.frozen,
		message: describeConflict(c, label),
		predecessors: c.predecessorIds.map((id) => ({ id, label: label(id), endDate: after.taskMap.get(id)?.endDate ?? null }))
	}));
}

export type ConflictDetail = ReturnType<typeof details>[number];

/**
 * Exempt changes (window, overflow, enforcement and stage window or deadline rules) go ahead
 * in strict mode, but their preview lists the conflicts they would cause; empty when the
 * series is not strict.
 */
export function exemptConflicts(ctx: Ctx, before: Plan, after: Plan): ConflictDetail[] {
	if (!ctx.series.strictMode) return [];
	const label = (id: string) => ctx.labels.get(id) ?? 'A task';
	const found = strictConflicts(before, after);
	return details([...found.filter((c) => c.frozen), ...found.filter((c) => !c.frozen)], after, label);
}

/**
 * Confirming an exempt change: every conflict it causes must have been acknowledged, by task
 * id, from its preview. A conflict that appeared since the preview is refused with the fresh
 * list, so it cannot slip through on an earlier acknowledgement.
 */
export function assertAcknowledged(conflicts: ConflictDetail[], acknowledged: string[] = []): void {
	const missing = conflicts.filter((c) => !acknowledged.includes(c.taskId));
	if (!missing.length) return;
	const names = missing.slice(0, 3).map((c) => c.label).join(', ') + (missing.length > 3 ? ` and ${missing.length - 3} more` : '');
	throw error(422, {
		error: 'conflicts_unacknowledged',
		message: `Strict mode: this change would leave ${missing.length === 1 ? 'a task' : `${missing.length} tasks`} starting before ${missing.length === 1 ? 'its' : 'their'} predecessors allow (${names}). Review them in the preview and acknowledge them to go ahead.`,
		taskIds: missing.map((c) => c.taskId),
		conflicts: missing
	});
}

/**
 * The 422 response when a strict series' change would cause a conflict, or null to go ahead.
 * @param always the tasks the change moves on purpose: they may not end in conflict at all.
 */
export function strictRefusal(ctx: Ctx, before: Plan, after: Plan, always: Iterable<string> = []): Response | null {
	const body = refusal(ctx, before, after, always);
	return body ? json(body, { status: 422 }) : null;
}

/** The same check for changes made deeper down (pipeline edits, removals, redo): throws the 422. */
export function assertStrict(ctx: Ctx, before: Plan, after: Plan, always: Iterable<string> = []): void {
	const body = refusal(ctx, before, after, always);
	if (body) throw error(422, body);
}
