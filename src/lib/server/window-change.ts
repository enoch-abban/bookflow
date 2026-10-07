/**
 * Creating, changing and deleting windows (spec: Changing windows). Under enforced
 * windows every change refits the schedule; the windows and every task they move are
 * saved as one batch so a single undo restores them. With `preview` nothing is saved.
 */
import { error } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { db } from '#lib/server/db/index.ts';
import { activityLog, windows } from '#lib/server/db/schema.ts';
import { loadSeriesContext } from './series-context.ts';
import { refit, type RefitResult } from './refit.ts';
import { refitChanges, refitReport, writeTaskChanges, type TaskChange, type Tx } from './schedule-write.ts';
import { overlapping, sortWindows } from '../schedule/windows.ts';

type WindowRow = typeof windows.$inferSelect;
type WindowFields = Pick<WindowRow, 'label' | 'startDate' | 'endDate'>;

export type WindowOp =
	| { kind: 'create'; fields: WindowFields }
	| { kind: 'update'; id: string; fields: Partial<WindowFields> }
	| { kind: 'delete'; id: string };

/** Keep sort_order in date order; it is derived, so it is not logged. */
async function renumber(tx: Tx, seriesId: string) {
	const rows = await tx.select({ id: windows.id }).from(windows).where(eq(windows.seriesId, seriesId)).orderBy(asc(windows.startDate));
	for (const [i, r] of rows.entries()) await tx.update(windows).set({ sortOrder: i + 1 }).where(eq(windows.id, r.id));
}

export async function loadWindow(id: string): Promise<WindowRow> {
	const row = await db.select().from(windows).where(eq(windows.id, id)).then((r) => r[0]);
	if (!row) throw error(404, 'Window not found');
	return row;
}

export async function changeWindows(opts: { seriesId: string; actorId: string; op: WindowOp; preview: boolean }) {
	const { seriesId, actorId, op } = opts;
	const ctx = await loadSeriesContext(seriesId);

	const before: WindowRow | null = op.kind === 'create' ? null : await loadWindow(op.id);
	if (before && before.seriesId !== seriesId) throw error(404, 'Window not found');

	const after: WindowRow | null =
		op.kind === 'delete' ? null
		: op.kind === 'create' ? { id: ulid(), seriesId, sortOrder: 0, ...op.fields }
		: { ...before!, ...op.fields };

	if (after) {
		if (after.endDate < after.startDate) throw error(400, 'The window cannot end before it starts.');
		const clash = overlapping(after, ctx.windows);
		if (clash) throw error(422, `This window would overlap "${(clash as { label?: string }).label ?? clash.id}" (${clash.startDate} to ${clash.endDate}).`);
	}

	const nextWindows = sortWindows([
		...ctx.windows.filter((w) => w.id !== before?.id),
		...(after ? [{ id: after.id, startDate: after.startDate, endDate: after.endDate, label: after.label }] : []),
	]);

	const original = new Map([...ctx.taskMap].map(([k, v]) => [k, { ...v }]));
	let result: RefitResult;
	let changes: TaskChange[];
	if (ctx.rules.enforce) {
		result = refit(ctx.taskMap, ctx.depList, { ...ctx.rules, windows: nextWindows });
		changes = refitChanges(result);
	} else {
		// Reference bands only: nothing moves. A deleted window just stops being referenced.
		const orphaned = op.kind === 'delete' ? [...ctx.taskMap.values()].filter((t) => t.windowId === op.id) : [];
		for (const t of orphaned) ctx.taskMap.set(t.id, { ...t, windowId: null });
		result = {
			changes: orphaned.map((t) => ({ id: t.id, kind: 'window' as const, before: { ...t }, after: { ...t, windowId: null } })),
			outsideWindow: [],
		};
		changes = refitChanges(result);
	}

	// Label old and new windows alike in the report.
	const report = refitReport({ ...ctx, windows: [...nextWindows, ...(before ? [before] : [])] }, original, result);
	if (opts.preview) return { preview: true as const, window: after, report };

	const batchId = ulid();
	const now = new Date().toISOString();
	await db.transaction(async (tx) => {
		if (op.kind === 'create') await tx.insert(windows).values(after!);
		if (op.kind === 'update') await tx.update(windows).set(op.fields).where(eq(windows.id, op.id));
		await writeTaskChanges(tx, { seriesId, actorId, batchId, now, original, changes });
		// Tasks are moved off a deleted window before the row goes (window_id is a foreign key).
		if (op.kind === 'delete') await tx.delete(windows).where(eq(windows.id, op.id));
		await renumber(tx, seriesId);
		await tx.insert(activityLog).values({
			id: ulid(), seriesId, actorId,
			entity: 'window', entityId: (after ?? before)!.id, action: op.kind,
			beforeJson: before ? JSON.stringify(before) : null,
			afterJson: after ? JSON.stringify(after) : null,
			batchId, createdAt: now,
		});
	});

	const saved = after ? await loadWindow(after.id) : null;
	return { preview: false as const, window: saved, report, batchId };
}
