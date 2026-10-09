/**
 * Activity history (spec: Activity log, Undo and redo): the series feed grouped into batches,
 * the names its lines need, and who may undo which batch. A user can undo their own last 50
 * changes on a series; an admin any change. A batch already reversed cannot be undone again.
 */
import { json } from '@sveltejs/kit';
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
			if (Array.isArray(o.personIds)) for (const id of o.personIds) if (typeof id === 'string') personIds.add(id);
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

	// Undo and redo items are headed by the original change behind them.
	const origins = new Map<string, Row[]>();
	for (const [k, l] of byKey) if (l[0].revertsBatchId) origins.set(k, await originalChange(l[0].revertsBatchId));
	const revertedRows = [...origins.values()].flat();

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
			headline: origins.has(k) && kind !== 'change'
				? `${kind === 'undo' ? 'Undid' : 'Redid'}: ${headline(origins.get(k)!.map(toEntry), names) || 'a change'}`
				: headline(entries, names),
			lines: entries.slice(0, 60).map((e) => describe(e, names)),
			count: entries.length,
			reverts: first.revertsBatchId,
			reversedBy: rev ? { batchId: rev.batchId, actor: actorName(rev.actorId), at: rev.at, action: rev.action } : null,
			canUndo: isBatch && refusal === null,
			canRedo: isBatch && redoRefusal({ actorId: first.actorId, kind, reversed: !!rev }, opts.viewer) === null,
			undoRefusal: isBatch ? refusal : null,
		};
	});
	return { items, cursor: more ? cursor : null };
}

/**
 * The original change behind an undo or redo: undo → change, redo → undo → change, and so on.
 * Returns its entries, oldest first, so a line can name what was undone or redone.
 */
export async function originalChange(batchId: string): Promise<Row[]> {
	let id: string | null = batchId;
	for (let hops = 0; id && hops < 200; hops++) {
		const rows: Row[] = await db.select().from(activityLog).where(eq(activityLog.batchId, id));
		if (!rows.length) return [];
		const kind = batchKind(rows.map(toEntry));
		if (kind === 'change' || !rows[0].revertsBatchId) return rows.sort((a, b) => a.id.localeCompare(b.id));
		id = rows[0].revertsBatchId;
	}
	return [];
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


/** A 409 naming what changed since, shared by undo and redo. */
export async function stepConflict(seriesId: string | null, taskIds: string[], other: string[]) {
	const named = await taskNames(seriesId, [...new Set(taskIds)]);
	const what = [
		named.length && `${named.slice(0, 5).join(', ')}${named.length > 5 ? ` and ${named.length - 5} more` : ''}`,
		...other,
	].filter(Boolean).join('; ');
	return json({ error: 'conflict', taskIds, other, message: `Can't do that: ${what} changed since, and it would overwrite that later edit.` }, { status: 409 });
}

/** Why the viewer cannot redo this batch, or null. Only the person who undid it can redo it. */
export function redoRefusal(batch: { actorId: string | null; kind: ReturnType<typeof batchKind>; reversed: boolean }, viewer: { personId: string }): string | null {
	if (batch.kind !== 'undo') return 'Only an undo can be redone.';
	if (batch.reversed) return 'This has already been redone.';
	if (batch.actorId !== viewer.personId) return 'Only the person who undid this can redo it.';
	return null;
}

/**
 * What the viewer's Undo and Redo buttons would do on this series: undo their newest change
 * (or redo) not yet undone, within their last 50; redo their newest undo not yet redone,
 * unless they have made a fresh change since, which clears the redo stack as usual.
 */
export async function stackState(personId: string, seriesId: string) {
	const rows = await db.select({ batchId: activityLog.batchId, last: sql<string>`max(${activityLog.id})`, kinds: sql<string>`group_concat(distinct ${activityLog.action})` })
		.from(activityLog)
		.where(and(eq(activityLog.actorId, personId), eq(activityLog.seriesId, seriesId), isNotNull(activityLog.batchId)))
		.groupBy(activityLog.batchId)
		.orderBy(desc(sql`max(${activityLog.id})`))
		.limit(UNDO_LIMIT * 3);
	const kindOf = (k: string) => (k === 'undo' ? 'undo' : k === 'redo' ? 'redo' : 'change');
	const batches = rows.map((r) => ({ batchId: r.batchId!, last: r.last, kind: kindOf(r.kinds) }));
	const reversed = await reversals(batches.map((b) => b.batchId));

	const undoable = batches.filter((b) => b.kind !== 'undo').slice(0, UNDO_LIMIT);
	const undo = undoable.find((b) => !reversed.has(b.batchId)) ?? null;
	const lastChange = batches.find((b) => b.kind === 'change');
	const redo = batches.find((b) => b.kind === 'undo' && !reversed.has(b.batchId) && (!lastChange || b.last > lastChange.last)) ?? null;

	// Both buttons name the original change they would take away or put back.
	const label = async (batchId: string) => {
		const list = (await originalChange(batchId)).map(toEntry);
		return headline(list, await namesFor(seriesId, list)) || 'a change';
	};
	return {
		undo: undo ? { batchId: undo.batchId, label: await label(undo.batchId) } : null,
		redo: redo ? { batchId: redo.batchId, label: await label(redo.batchId) } : null,
	};
}
