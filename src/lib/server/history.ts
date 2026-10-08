/**
 * Activity history (spec: Activity log, Undo and redo): the series feed grouped into batches,
 * the names its lines need, and who may undo which batch. A user can undo their own last 50
 * changes on a series; an admin any change. A batch already reversed cannot be undone again.
 */
import { and, desc, eq, inArray, isNotNull, lt, ne, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { activityLog, books, people, stages, tasks, tracks, windows } from '#lib/server/db/schema.ts';
import { batchKind, describe, headline, type LogEntry, type Names } from '#lib/activity/describe.ts';

export const UNDO_LIMIT = 50;

type Row = typeof activityLog.$inferSelect;
const toEntry = (r: Row): LogEntry => ({
	id: r.id, entity: r.entity, entityId: r.entityId, action: r.action,
	before: r.beforeJson ? JSON.parse(r.beforeJson) : null, after: r.afterJson ? JSON.parse(r.afterJson) : null,
});

/** The actor's last 50 undoable batches on a series (their changes and redos, newest first). */
export async function recentBatches(actorId: string, seriesId: string, limit = UNDO_LIMIT): Promise<string[]> {
	const rows = await db.select({ batchId: activityLog.batchId, last: sql<string>`max(${activityLog.id})` })
		.from(activityLog)
		.where(and(eq(activityLog.actorId, actorId), eq(activityLog.seriesId, seriesId), isNotNull(activityLog.batchId), ne(activityLog.action, 'undo')))
		.groupBy(activityLog.batchId)
		.orderBy(desc(sql`max(${activityLog.id})`))
		.limit(limit);
	return rows.map((r) => r.batchId!);
}

/** Batches that have been reversed, and by which batch. */
export async function reversals(batchIds: string[]) {
	const out = new Map<string, { batchId: string; actorId: string | null; at: string; action: string }>();
	if (!batchIds.length) return out;
	const rows = await db.select({ reverts: activityLog.revertsBatchId, batchId: activityLog.batchId, actorId: activityLog.actorId, at: activityLog.createdAt, action: activityLog.action })
		.from(activityLog).where(inArray(activityLog.revertsBatchId, batchIds));
	for (const r of rows) if (!out.has(r.reverts!)) out.set(r.reverts!, { batchId: r.batchId!, actorId: r.actorId, at: r.at, action: r.action });
	return out;
}

/**
 * Why the viewer cannot undo this batch, or null if they can. `recent` is the viewer's own
 * last 50 batches on the series, passed in so a page can check many batches with one query.
 */
export function undoRefusal(
	batch: { batchId: string; actorId: string | null; kind: ReturnType<typeof batchKind>; reversed: boolean },
	viewer: { personId: string; isAdmin: boolean },
	recent: string[],
): string | null {
	if (batch.reversed) return 'This change has already been undone.';
	if (batch.kind === 'undo') return 'This is an undo; use Redo to reapply the change.';
	if (viewer.isAdmin) return null;
	if (batch.actorId !== viewer.personId) return 'You can only undo your own changes.';
	if (!recent.includes(batch.batchId)) return `You can undo only your last ${UNDO_LIMIT} changes on this series.`;
	return null;
}

/** Names for every id the entries mention, so lines read "G3 Layout" rather than an id. */
export async function namesFor(seriesId: string | null, entries: LogEntry[]): Promise<Names> {
	const taskIds = new Set<string>();
	const personIds = new Set<string>();
	for (const e of entries) {
		if (e.entity === 'task' || e.entity === 'review') taskIds.add(e.entityId);
		for (const o of [e.before, e.after]) {
			if (!o) continue;
			for (const k of ['predecessorId', 'successorId', 'taskId']) if (typeof o[k] === 'string') taskIds.add(o[k] as string);
			if (typeof o.personId === 'string') personIds.add(o.personId);
		}
		if (e.entity === 'person' || e.entity === 'member') personIds.add(e.entityId);
	}
	const ids = [...taskIds];
	const [taskRows, bookRows, stageRows, trackRows, windowRows, peopleRows] = await Promise.all([
		ids.length
			? db.select({ id: tasks.id, code: books.code, stage: stages.name }).from(tasks)
				.innerJoin(books, eq(books.id, tasks.bookId)).innerJoin(stages, eq(stages.id, tasks.stageId)).where(inArray(tasks.id, ids))
			: [],
		seriesId ? db.select({ id: books.id, code: books.code }).from(books).where(eq(books.seriesId, seriesId)) : [],
		seriesId ? db.select({ id: stages.id, name: stages.name }).from(stages).where(eq(stages.seriesId, seriesId)) : [],
		seriesId ? db.select({ id: tracks.id, name: tracks.name }).from(tracks).where(eq(tracks.seriesId, seriesId)) : [],
		seriesId ? db.select({ id: windows.id, label: windows.label }).from(windows).where(eq(windows.seriesId, seriesId)) : [],
		personIds.size ? db.select({ id: people.id, name: people.displayName }).from(people).where(inArray(people.id, [...personIds])) : [],
	]);
	const m = <T extends { id: string }>(rows: T[], f: (r: T) => string) => new Map(rows.map((r) => [r.id, f(r)]));
	const t = m(taskRows, (r) => `${r.code} ${r.stage}`);
	const bk = m(bookRows, (r) => r.code);
	const st = m(stageRows, (r) => r.name);
	const tr = m(trackRows, (r) => r.name);
	const w = m(windowRows, (r) => r.label);
	const p = m(peopleRows, (r) => r.name);
	// Tasks deleted since: name them from the book and stage their snapshot points at.
	for (const e of entries) {
		if (e.entity !== 'task' || t.has(e.entityId)) continue;
		const snap = (e.before?.task ?? e.after?.task ?? e.before ?? e.after) as Record<string, string> | null;
		if (snap?.bookId && snap.stageId && bk.has(snap.bookId)) t.set(e.entityId, `${bk.get(snap.bookId)} ${st.get(snap.stageId) ?? snap.title ?? ''}`.trim());
	}
	return { task: (id) => t.get(id), book: (id) => bk.get(id), stage: (id) => st.get(id), track: (id) => tr.get(id), window: (id) => w.get(id), person: (id) => p.get(id) };
}

/**
 * A page of the series feed, newest first. Entries of one batch are grouped into one item;
 * entries outside a batch (status changes, comments) stand alone. `before` is a cursor: the
 * id of the oldest entry on the previous page.
 */
export async function feed(opts: { seriesId: string; viewer: { personId: string; isAdmin: boolean }; actorId?: string; before?: string; limit?: number }) {
	const limit = opts.limit ?? 40;
	const where = and(
		eq(activityLog.seriesId, opts.seriesId),
		opts.actorId ? eq(activityLog.actorId, opts.actorId) : undefined,
		opts.before ? lt(activityLog.id, opts.before) : undefined,
	);
	const rows = await db.select().from(activityLog).where(where).orderBy(desc(activityLog.id)).limit(limit * 25);

	// Group into items until the page is full; the cursor is the oldest entry kept.
	const keys: string[] = [];
	const seen = new Set<string>();
	let cursor: string | null = null;
	for (const r of rows) {
		const key = r.batchId ?? r.id;
		if (!seen.has(key)) {
			if (keys.length === limit) break;
			seen.add(key);
			keys.push(key);
		}
		cursor = r.id;
	}
	// More pages exist if rows remain past the cursor, or the fetch hit its cap.
	const more = rows.findIndex((r) => r.id === cursor) < rows.length - 1 || rows.length === limit * 25;

	// Complete each batch: some of its entries may sit past the page edge or in another series (holidays).
	const batchIds = keys.filter((k) => rows.some((r) => r.batchId === k));
	const full = batchIds.length ? await db.select().from(activityLog).where(inArray(activityLog.batchId, batchIds)) : [];
	const byKey = new Map<string, Row[]>();
	for (const r of [...full, ...rows.filter((r) => !r.batchId && seen.has(r.id))]) {
		const k = r.batchId ?? r.id;
		byKey.set(k, [...(byKey.get(k) ?? []), r]);
	}
	for (const list of byKey.values()) list.sort((a, b) => a.id.localeCompare(b.id));

	// Undo and redo items are headed by the change they reversed.
	const revertedIds = [...new Set([...byKey.values()].map((l) => l[0].revertsBatchId).filter((x): x is string => !!x))];
	const revertedRows = revertedIds.length ? await db.select().from(activityLog).where(inArray(activityLog.batchId, revertedIds)) : [];

	const allEntries = [...byKey.values()].flat().concat(revertedRows).map(toEntry);
	const names = await namesFor(opts.seriesId, allEntries);
	const reversed = await reversals(batchIds);
	const recent = await recentBatches(opts.viewer.personId, opts.seriesId);
	const actorIds = [...new Set([...byKey.values()].map((l) => l[0].actorId).filter((x): x is string => !!x)
		.concat([...reversed.values()].map((r) => r.actorId).filter((x): x is string => !!x)))];
	const actors = actorIds.length ? await db.select({ id: people.id, name: people.displayName }).from(people).where(inArray(people.id, actorIds)) : [];
	const actorName = (id: string | null) => (id ? actors.find((a) => a.id === id)?.name ?? 'Someone' : 'System');

	const items = keys.map((k) => {
		const list = byKey.get(k)!;
		const entries = list.map(toEntry);
		const first = list[0];
		const isBatch = !!first.batchId;
		const kind = batchKind(entries);
		const rev = isBatch ? reversed.get(k) : undefined;
		const refusal = isBatch ? undoRefusal({ batchId: k, actorId: first.actorId, kind, reversed: !!rev }, opts.viewer, recent) : 'Only schedule and pipeline changes can be undone.';
		return {
			key: k,
			batchId: isBatch ? k : null,
			kind,
			actorId: first.actorId,
			actor: actorName(first.actorId),
			at: list.at(-1)!.createdAt,
			headline: first.revertsBatchId && kind !== 'change'
				? `${kind === 'undo' ? 'Undid' : 'Redid'}: ${headline(revertedRows.filter((r) => r.batchId === first.revertsBatchId).sort((a, b) => a.id.localeCompare(b.id)).map(toEntry), names) || 'a change'}`
				: headline(entries, names),
			lines: entries.slice(0, 60).map((e) => describe(e, names)),
			count: entries.length,
			reverts: first.revertsBatchId,
			reversedBy: rev ? { batchId: rev.batchId, actor: actorName(rev.actorId), at: rev.at, action: rev.action } : null,
			canUndo: isBatch && refusal === null,
			undoRefusal: isBatch ? refusal : null,
		};
	});
	return { items, cursor: more ? cursor : null };
}

/** "G3 Layout, G4 Layout" for the tasks an undo conflict names. */
export async function taskNames(seriesId: string | null, ids: string[]): Promise<string[]> {
	if (!ids.length) return [];
	const names = await namesFor(seriesId, ids.map((id) => ({ id, entity: 'task', entityId: id, action: '', before: null, after: null })));
	return ids.map((id) => names.task(id) ?? 'a deleted task');
}

/** People who have made changes on the series, for the feed's filter. */
export async function actorsOf(seriesId: string) {
	const rows = await db.selectDistinct({ id: people.id, name: people.displayName }).from(activityLog)
		.innerJoin(people, eq(people.id, activityLog.actorId)).where(eq(activityLog.seriesId, seriesId));
	return rows.sort((a, b) => a.name.localeCompare(b.name));
}

