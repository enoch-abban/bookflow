/**
 * Removing a book or a stage (spec: Pipeline changes, "Remove a stage or book").
 * Not-started tasks are deleted and their dependencies relinked around them. Started
 * tasks block the removal. Done tasks are kept as history: the book or stage is then
 * archived instead of deleted. A book with an ISBN or print approval is only ever
 * archived. Previewed, then saved as one undoable batch.
 */
import { error } from '@sveltejs/kit';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { ulid } from 'ulid';
import { db } from '#lib/server/db/index.ts';
import {
	activityLog, baselineTasks, bookStageSkips, books, dependencies, printApprovals, printRecords, stageLinks, stageTracks,
	stages, taskAssignees, taskComments, tasks
} from '#lib/server/db/schema.ts';
import { parseRule } from '../schedule/deadlines.ts';
import type { Tx } from './schedule-write.ts';
import { planRelink } from '../schedule/relink.ts';

type Dep = typeof dependencies.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;

const STARTED = ['in_progress', 'in_review', 'returned'];
export const isStarted = (t: Pick<TaskRow, 'status' | 'statusBeforeBlock'>) =>
	STARTED.includes(t.status) || (t.status === 'blocked' && STARTED.includes(t.statusBeforeBlock ?? ''));

export type Log = (entity: 'book' | 'stage' | 'track' | 'task' | 'dependency' | 'skip' | 'stage_link', entityId: string, action: string, before: unknown, after: unknown) => typeof activityLog.$inferInsert;

export function logger(seriesId: string, actorId: string, batchId: string, now: string): Log {
	return (entity, entityId, action, before, after) => ({
		id: ulid(), seriesId, actorId, entity, entityId, action,
		beforeJson: before ? JSON.stringify(before) : null,
		afterJson: after ? JSON.stringify(after) : null,
		batchId, createdAt: now,
	});
}

/**
 * Delete not-started tasks and relink their dependencies. Assignees, baseline rows and
 * comments are removed explicitly and kept in the log entry, so undo restores the task
 * whole, baseline variance included.
 */
export async function deleteTasks(tx: Tx, log: Log, doomed: TaskRow[], touching: Dep[], bridges: Dep[]) {
	if (!doomed.length) return;
	const ids = doomed.map((t) => t.id);
	const assignees = await tx.select().from(taskAssignees).where(inArray(taskAssignees.taskId, ids));
	const baseline = await tx.select().from(baselineTasks).where(inArray(baselineTasks.taskId, ids));
	const comments = await tx.select().from(taskComments).where(inArray(taskComments.taskId, ids));
	if (touching.length) await tx.delete(dependencies).where(inArray(dependencies.id, touching.map((d) => d.id)));
	await tx.delete(taskAssignees).where(inArray(taskAssignees.taskId, ids));
	await tx.delete(baselineTasks).where(inArray(baselineTasks.taskId, ids));
	await tx.delete(taskComments).where(inArray(taskComments.taskId, ids));
	await tx.delete(tasks).where(inArray(tasks.id, ids));
	for (const t of doomed) {
		const own = touching.filter((d) => d.predecessorId === t.id || d.successorId === t.id);
		await tx.insert(activityLog).values(log('task', t.id, 'delete', {
			task: t,
			assignees: assignees.filter((a) => a.taskId === t.id),
			dependencies: own,
			baseline: baseline.filter((b) => b.taskId === t.id),
			comments: comments.filter((c) => c.taskId === t.id),
		}, null));
	}
	for (const b of bridges) {
		await tx.insert(dependencies).values(b);
		await tx.insert(activityLog).values(log('dependency', b.id, 'create', null, b));
	}
}

async function seriesDeps(seriesId: string): Promise<Dep[]> {
	return db.select({ d: dependencies }).from(dependencies)
		.innerJoin(tasks, eq(tasks.id, dependencies.successorId))
		.innerJoin(books, eq(books.id, tasks.bookId))
		.where(eq(books.seriesId, seriesId))
		.then((r) => r.map((x) => x.d));
}

function startedConflict(started: { label: string }[], what: string) {
	const one = started.length === 1;
	return error(409, `${what} cannot be removed while ${one ? 'this task has' : 'these tasks have'} started: ${started.map((s) => s.label).join(', ')}. Finish ${one ? 'it' : 'them'} or reset ${one ? 'it' : 'them'} to Not started first.`);
}

// ── Books ──────────────────────────────────────────────────────────────────────

export async function removeBook(opts: { bookId: string; actorId: string; preview: boolean }) {
	const book = await db.select().from(books).where(eq(books.id, opts.bookId)).then((r) => r[0]);
	if (!book || book.archivedAt) throw error(404, 'Book not found');

	const own = await db.select({ t: tasks, stage: stages.name }).from(tasks)
		.innerJoin(stages, eq(stages.id, tasks.stageId)).where(eq(tasks.bookId, book.id));
	const started = own.filter((r) => isStarted(r.t)).map((r) => ({ label: `${r.stage} · ${book.code}` }));
	if (started.length) throw startedConflict(started, book.code);

	const done = own.filter((r) => r.t.status === 'done');
	const doomed = own.filter((r) => r.t.status !== 'done').map((r) => r.t);
	const approval = await db.select().from(printApprovals).where(eq(printApprovals.bookId, book.id));
	const archive = done.length > 0 || !!book.isbn || approval.length > 0;
	const reason = done.length ? `${done.length} Done ${done.length === 1 ? 'task is' : 'tasks are'} kept as history`
		: book.isbn ? 'it has an ISBN' : approval.length ? 'it is approved for print' : null;

	const { touching, bridges } = planRelink(new Set(doomed.map((t) => t.id)), await seriesDeps(book.seriesId), ulid);
	const report = {
		book: book.code, archive, reason, deletesTasks: doomed.length, keepsTasks: done.length,
		relinked: bridges.length,
	};
	if (opts.preview) return { preview: true as const, ...report };

	const batchId = ulid();
	const now = new Date().toISOString();
	const log = logger(book.seriesId, opts.actorId, batchId, now);
	await db.transaction(async (tx) => {
		await deleteTasks(tx, log, doomed, touching, bridges);
		if (archive) {
			await tx.update(books).set({ archivedAt: now, version: book.version + 1 }).where(eq(books.id, book.id));
			await tx.insert(activityLog).values(log('book', book.id, 'archive', { archivedAt: null, version: book.version }, { archivedAt: now, version: book.version + 1 }));
		} else {
			const skips = await tx.select().from(bookStageSkips).where(eq(bookStageSkips.bookId, book.id));
			const record = await tx.select().from(printRecords).where(eq(printRecords.bookId, book.id)).then((r) => r[0] ?? null);
			await tx.delete(bookStageSkips).where(eq(bookStageSkips.bookId, book.id));
			await tx.delete(printRecords).where(eq(printRecords.bookId, book.id));
			await tx.delete(books).where(eq(books.id, book.id));
			await tx.insert(activityLog).values(log('book', book.id, 'delete', { book, skips, printRecord: record }, null));
		}
	});
	return { preview: false as const, ...report, batchId };
}

// ── Stages ─────────────────────────────────────────────────────────────────────

export async function removeStage(opts: { stageId: string; actorId: string; preview: boolean }) {
	const stage = await db.select().from(stages).where(eq(stages.id, opts.stageId)).then((r) => r[0]);
	if (!stage || stage.archivedAt) throw error(404, 'Stage not found');

	// Another stage's deadline counting from this one would silently lose its base.
	const others = await db.select().from(stages).where(and(eq(stages.seriesId, stage.seriesId), isNull(stages.archivedAt)));
	const dependents = others.filter((s) => s.id !== stage.id && parseRule(s.deadlineRule)?.after === stage.key);
	if (dependents.length)
		throw error(409, `${dependents.map((s) => s.name).join(', ')} ${dependents.length === 1 ? 'has a deadline' : 'have deadlines'} counting from ${stage.name}. Change ${dependents.length === 1 ? 'it' : 'them'} first.`);

	const own = await db.select({ t: tasks, code: books.code }).from(tasks)
		.innerJoin(books, eq(books.id, tasks.bookId)).where(eq(tasks.stageId, stage.id));
	const started = own.filter((r) => isStarted(r.t)).map((r) => ({ label: `${stage.name} · ${r.code}` }));
	if (started.length) throw startedConflict(started, stage.name);

	const done = own.filter((r) => r.t.status === 'done');
	const doomed = own.filter((r) => r.t.status !== 'done').map((r) => r.t);
	const archive = done.length > 0;
	const { touching, bridges } = planRelink(new Set(doomed.map((t) => t.id)), await seriesDeps(stage.seriesId), ulid);

	// The series' pattern bridges the stage the same way: its predecessors to its successors.
	const links = await db.select().from(stageLinks).where(or(eq(stageLinks.fromStageId, stage.id), eq(stageLinks.toStageId, stage.id)));
	const allLinks = await db.select({ l: stageLinks }).from(stageLinks).innerJoin(stages, eq(stages.id, stageLinks.fromStageId))
		.where(eq(stages.seriesId, stage.seriesId)).then((r) => r.map((x) => x.l));
	const asDeps = allLinks.map((l) => ({ id: `${l.fromStageId}>${l.toStageId}`, predecessorId: l.fromStageId, successorId: l.toStageId, lagDays: l.lagDays }));
	const linkBridges = planRelink(new Set([stage.id]), asDeps, ulid).bridges
		.map((b) => ({ fromStageId: b.predecessorId, toStageId: b.successorId, lagDays: b.lagDays }));

	const report = {
		stage: stage.name, archive, deletesTasks: doomed.length, keepsTasks: done.length,
		books: [...new Set(doomed.map((t) => own.find((r) => r.t.id === t.id)!.code))],
		relinked: bridges.length, patternRelinked: linkBridges.length,
	};
	if (opts.preview) return { preview: true as const, ...report };

	const batchId = ulid();
	const now = new Date().toISOString();
	const log = logger(stage.seriesId, opts.actorId, batchId, now);
	await db.transaction(async (tx) => {
		await deleteTasks(tx, log, doomed, touching, bridges);
		for (const l of links) {
			await tx.delete(stageLinks).where(and(eq(stageLinks.fromStageId, l.fromStageId), eq(stageLinks.toStageId, l.toStageId)));
			await tx.insert(activityLog).values(log('stage_link', `${l.fromStageId}>${l.toStageId}`, 'delete', l, null));
		}
		for (const l of linkBridges) {
			await tx.insert(stageLinks).values(l).onConflictDoNothing();
			await tx.insert(activityLog).values(log('stage_link', `${l.fromStageId}>${l.toStageId}`, 'create', null, l));
		}
		if (archive) {
			await tx.update(stages).set({ archivedAt: now }).where(eq(stages.id, stage.id));
			await tx.insert(activityLog).values(log('stage', stage.id, 'archive', { archivedAt: null }, { archivedAt: now }));
		} else {
			const tracksOf = await tx.select().from(stageTracks).where(eq(stageTracks.stageId, stage.id));
			const skips = await tx.select().from(bookStageSkips).where(eq(bookStageSkips.stageId, stage.id));
			await tx.delete(stageTracks).where(eq(stageTracks.stageId, stage.id));
			await tx.delete(bookStageSkips).where(eq(bookStageSkips.stageId, stage.id));
			await tx.delete(stages).where(eq(stages.id, stage.id));
			await tx.insert(activityLog).values(log('stage', stage.id, 'delete', { stage, stageTracks: tracksOf, skips }, null));
		}
	});
	return { preview: false as const, ...report, batchId };
}
