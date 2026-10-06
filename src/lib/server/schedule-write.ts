/**
 * Saving schedule changes: one place that writes task placements and their activity
 * log entries, so every endpoint records the same before/after shape for undo.
 */
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { db } from '#lib/server/db/index.ts';
import { activityLog, tasks } from '#lib/server/db/schema.ts';
import type { SchedTask } from './scheduler.ts';
import type { RefitResult } from './refit.ts';
import { projectedFinish, type SeriesContext } from './series-context.ts';

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type TaskChange = {
	id: string;
	startDate: string;
	endDate: string;
	durationDays?: number;
	windowId: string | null;
	scheduleState?: 'scheduled' | 'unscheduled';
	action: string;
};

const snapshot = (t: Pick<SchedTask, 'startDate' | 'endDate' | 'durationDays' | 'windowId' | 'scheduleState' | 'version'>) => ({
	startDate: t.startDate, endDate: t.endDate, durationDays: t.durationDays,
	windowId: t.windowId, scheduleState: t.scheduleState ?? 'scheduled', version: t.version,
});

/**
 * Write each change, bump its version and log it under `batchId`.
 * @param original Task state before the change (versions are taken from here).
 */
export async function writeTaskChanges(
	tx: Tx,
	opts: { seriesId: string; actorId: string; batchId: string; now: string; original: Map<string, SchedTask>; changes: TaskChange[] }
) {
	const out = [];
	for (const c of opts.changes) {
		const orig = opts.original.get(c.id)!;
		const after = {
			startDate: c.startDate, endDate: c.endDate, durationDays: c.durationDays ?? orig.durationDays,
			windowId: c.windowId, scheduleState: c.scheduleState ?? 'scheduled', version: orig.version + 1,
		};
		await tx.update(tasks).set({ ...after, updatedAt: opts.now }).where(eq(tasks.id, c.id));
		await tx.insert(activityLog).values({
			id: ulid(), seriesId: opts.seriesId, actorId: opts.actorId,
			entity: 'task', entityId: c.id, action: c.action,
			beforeJson: JSON.stringify(snapshot(orig)), afterJson: JSON.stringify(after),
			batchId: opts.batchId, createdAt: opts.now,
		});
		out.push({ id: c.id, ...after });
	}
	return out;
}

/** Turn a refit result into task changes for writeTaskChanges. */
export function refitChanges(result: RefitResult): TaskChange[] {
	return result.changes.map((c) => ({
		id: c.id, ...c.after, windowId: c.after.windowId ?? null,
		action: c.kind === 'unscheduled' ? 'unschedule' : c.kind === 'placed' ? 'place' : c.kind === 'window' ? 'rewindow' : 'move',
	}));
}

/** The impact of a refit, as shown in previews and returned after saving. */
export function refitReport(ctx: SeriesContext, original: Map<string, SchedTask>, result: RefitResult) {
	const count = (k: string) => result.changes.filter((c) => c.kind === k).length;
	const winLabel = new Map(ctx.windows.map((w) => [w.id, w.label]));
	return {
		moved: count('moved'),
		unscheduled: count('unscheduled'),
		placed: count('placed'),
		rewindowed: count('window'),
		outsideWindow: result.outsideWindow.map((id) => ({ id, label: ctx.labels.get(id) ?? id })),
		projectedFinish: { before: projectedFinish(original, ctx.finishTaskIds), after: projectedFinish(ctx.taskMap, ctx.finishTaskIds) },
		changes: result.changes.map((c) => ({
			id: c.id, label: ctx.labels.get(c.id) ?? c.id, kind: c.kind,
			from: { ...c.before, window: c.before.windowId ? winLabel.get(c.before.windowId) ?? null : null },
			to: { ...c.after, window: c.after.windowId ? winLabel.get(c.after.windowId) ?? null : null },
		})),
	};
}
