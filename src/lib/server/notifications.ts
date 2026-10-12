/**
 * Notifications about someone's work (spec: Phase 2, notifications on handoff, return and
 * lateness). A change is saved first; who to tell is worked out afterwards, in the
 * background, so a status click never waits on email. Every notification is stored; the
 * email goes to people with an account who have not turned task emails off.
 *
 * The team works in Africa/Accra (UTC+0), so "today" is the UTC date and the morning job
 * runs at 07:00 UTC (vercel.json).
 */
import { waitUntil } from '@vercel/functions';
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { ORIGIN } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { books, dependencies, notifications, people, series, seriesMembers, stages, taskAssignees, tasks } from '#lib/server/db/schema.ts';
import { sendEmail } from '#lib/server/email.ts';
import { refreshHolidays } from '#lib/server/calendar-db.ts';
import { reviewersOf } from '#lib/server/reviews.ts';
import { isWorkingDay } from '#lib/schedule/calendar.ts';
import {
	handoffMessage, isLate, lateDigest, lateKey, lateMessage, readySuccessors, returnedMessage, reviewRequestMessage,
	type Kind, type Message
} from '#lib/notifications/messages.ts';

type NewNotification = typeof notifications.$inferInsert;
const MAX_ATTEMPTS = 3;

/** Run after the response is sent (Vercel keeps the function alive for it); never throws. */
export function background(work: () => Promise<unknown>) {
	const run = work().catch((e) => console.error('[notifications]', e));
	waitUntil(run);
}

const taskLink = (seriesId: string, taskId: string) => `${ORIGIN}/s/${seriesId}?task=${taskId}`;

/** A task with the names its messages use. */
async function describe(taskIds: string[]) {
	const rows = await db.select({ t: tasks, stage: stages.name, book: books.code, seriesId: books.seriesId, series: series.name })
		.from(tasks).innerJoin(stages, eq(stages.id, tasks.stageId)).innerJoin(books, eq(books.id, tasks.bookId))
		.innerJoin(series, eq(series.id, books.seriesId)).where(inArray(tasks.id, taskIds));
	return new Map(rows.map((r) => [r.t.id, { ...r, ref: { stage: r.stage, book: r.book, series: r.series, link: taskLink(r.seriesId, r.t.id) } }]));
}

async function assigneesOf(taskIds: string[]) {
	const rows = taskIds.length
		? await db.select({ taskId: taskAssignees.taskId, personId: taskAssignees.personId, name: people.displayName })
			.from(taskAssignees).innerJoin(people, eq(people.id, taskAssignees.personId)).where(inArray(taskAssignees.taskId, taskIds))
			.orderBy(asc(people.displayName))
		: [];
	const out = new Map<string, { personId: string; name: string }[]>();
	for (const r of rows) out.set(r.taskId, [...(out.get(r.taskId) ?? []), r]);
	return out;
}

const personName = (id: string) => db.select({ name: people.displayName }).from(people).where(eq(people.id, id)).then((r) => r[0]?.name ?? 'Someone');

function rows(personIds: string[], base: { seriesId: string; taskId: string; kind: Kind; dedupeKey?: string }, m: Message, actorId?: string): NewNotification[] {
	const now = new Date().toISOString();
	return [...new Set(personIds)]
		.filter((p) => p !== actorId) // nobody is told about their own action
		.map((personId) => ({ personId, ...base, subject: m.subject, body: m.body, createdAt: now }));
}

/**
 * Who to tell about a status change, and what. Submit for review tells the reviewers;
 * a return tells the assignees, with the reviewer's summary; Done tells the people on each
 * task that can now start.
 */
export async function notifyStatusChange(opts: { taskId: string; to: string; actorId: string; summary?: string | null }) {
	const info = (await describe([opts.taskId])).get(opts.taskId);
	if (!info) return;
	const { t: task, seriesId } = info;
	const out: NewNotification[] = [];

	if (opts.to === 'in_review') {
		const { people: reviewers } = await reviewersOf(task);
		const m = reviewRequestMessage({ ...info.ref, round: task.iteration }, await personName(opts.actorId));
		out.push(...rows(reviewers.map((p) => p.id), { seriesId, taskId: task.id, kind: 'review_request' }, m, opts.actorId));
	}

	if (opts.to === 'returned') {
		const who = (await assigneesOf([task.id])).get(task.id) ?? [];
		const m = returnedMessage(info.ref, await personName(opts.actorId), opts.summary ?? '');
		out.push(...rows(who.map((a) => a.personId), { seriesId, taskId: task.id, kind: 'returned' }, m, opts.actorId));
	}

	if (opts.to === 'done') {
		// The book's tasks and links: enough to see which successors have nothing left to wait for.
		const own = await db.select({ id: tasks.id, status: tasks.status }).from(tasks).where(eq(tasks.bookId, task.bookId));
		const byId = new Map(own.map((r) => [r.id, r]));
		const succIds = (await db.select({ id: dependencies.successorId }).from(dependencies).where(eq(dependencies.predecessorId, task.id))).map((d) => d.id);
		// Successors may sit in another book, so load their predecessors' links and statuses too.
		const deps = succIds.length ? await db.select().from(dependencies).where(inArray(dependencies.successorId, succIds)) : [];
		const missing = [...new Set(deps.flatMap((d) => [d.predecessorId, d.successorId]))].filter((id) => !byId.has(id));
		if (missing.length) for (const r of await db.select({ id: tasks.id, status: tasks.status }).from(tasks).where(inArray(tasks.id, missing))) byId.set(r.id, r);

		const ready = readySuccessors(task.id, deps, byId);
		const named = await describe([...ready.map((s) => s.id), ...deps.map((d) => d.predecessorId)]);
		const who = await assigneesOf(ready.map((s) => s.id));
		for (const s of ready) {
			const succ = named.get(s.id);
			if (!succ) continue;
			const finished = deps.filter((d) => d.successorId === s.id).flatMap((d) => { const p = named.get(d.predecessorId); return p ? [`${p.stage} · ${p.book}`] : []; });
			const m = handoffMessage({ ...succ.ref, start: succ.t.startDate }, finished);
			out.push(...rows((who.get(s.id) ?? []).map((a) => a.personId), { seriesId: succ.seriesId, taskId: s.id, kind: 'handoff' }, m, opts.actorId));
		}
	}

	await queue(out);
}

/** Store notifications (a repeat of a deduplicated one is dropped) and email them. */
export async function queue(list: NewNotification[]) {
	if (!list.length) return;
	const saved = await db.insert(notifications).values(list).onConflictDoNothing().returning({ id: notifications.id });
	await deliver(saved.map((r) => r.id));
}

/**
 * Email pending notifications: the given ones, or every one still pending (the morning job's
 * retry). Late notices for one person go out as one email. People without an account, who are
 * inactive or who turned task emails off are skipped; the notification is kept either way.
 */
export async function deliver(ids?: string[]) {
	if (ids && !ids.length) return { sent: 0, skipped: 0, failed: 0 };
	const pending = await db.select({ n: notifications, email: people.email, userId: people.userId, active: people.active, wants: people.emailNotifications })
		.from(notifications).innerJoin(people, eq(people.id, notifications.personId))
		.where(and(eq(notifications.emailStatus, 'pending'), ids ? inArray(notifications.id, ids) : undefined))
		.orderBy(asc(notifications.createdAt));

	const tally = { sent: 0, skipped: 0, failed: 0 };
	const skip = pending.filter((r) => !r.email || !r.userId || !r.active || !r.wants);
	if (skip.length) {
		await db.update(notifications).set({ emailStatus: 'skipped' }).where(inArray(notifications.id, skip.map((r) => r.n.id)));
		tally.skipped = skip.length;
	}

	// One email per notification, except late notices: one per person.
	const groups = new Map<string, typeof pending>();
	for (const r of pending.filter((r) => !skip.includes(r))) {
		const key = r.n.kind === 'late' ? `late:${r.n.personId}` : r.n.id;
		groups.set(key, [...(groups.get(key) ?? []), r]);
	}
	for (const group of groups.values()) {
		const first = group[0];
		const m = first.n.kind === 'late' ? lateDigest(group.map((r) => r.n)) : first.n;
		const groupIds = group.map((r) => r.n.id);
		try {
			await sendEmail({ to: first.email!, subject: m.subject, text: m.body });
			await db.update(notifications).set({ emailStatus: 'sent', emailedAt: new Date().toISOString() }).where(inArray(notifications.id, groupIds));
			tally.sent += group.length;
		} catch (e) {
			console.error('[notifications] email failed', e);
			const attempts = first.n.emailAttempts + 1;
			await db.update(notifications)
				.set({ emailAttempts: attempts, emailStatus: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending' })
				.where(inArray(notifications.id, groupIds));
			tally.failed += group.length;
		}
	}
	return tally;
}

/**
 * The morning job. On working days, tell the people on each task that has just turned late,
 * and its series' coordinators (admins, when a series has none), once per task and end date.
 * Every day, retry emails that failed.
 */
export async function runDaily(today = new Date().toISOString().slice(0, 10)) {
	await refreshHolidays();
	let late = 0;
	if (isWorkingDay(today)) {
		const live = and(ne(series.status, 'closed'), isNull(books.archivedAt), isNull(stages.archivedAt));
		const candidates = await db.select({ t: tasks, seriesId: books.seriesId }).from(tasks)
			.innerJoin(books, eq(books.id, tasks.bookId)).innerJoin(stages, eq(stages.id, tasks.stageId)).innerJoin(series, eq(series.id, books.seriesId))
			.where(and(live, eq(tasks.scheduleState, 'scheduled'), ne(tasks.status, 'done')));
		const lateTasks = candidates.filter((r) => isLate(r.t, today));
		if (lateTasks.length) {
			const ids = lateTasks.map((r) => r.t.id);
			const [named, who, coords, admins] = await Promise.all([
				describe(ids),
				assigneesOf(ids),
				db.select({ seriesId: seriesMembers.seriesId, personId: seriesMembers.personId }).from(seriesMembers)
					.innerJoin(people, eq(people.id, seriesMembers.personId))
					.where(and(eq(seriesMembers.role, 'coordinator'), eq(people.active, 1), inArray(seriesMembers.seriesId, [...new Set(lateTasks.map((r) => r.seriesId))]))),
				db.select({ id: people.id }).from(people).where(and(eq(people.systemRole, 'admin'), eq(people.active, 1)))
			]);
			const out: NewNotification[] = [];
			for (const { t, seriesId } of lateTasks) {
				const info = named.get(t.id);
				if (!info) continue;
				const on = who.get(t.id) ?? [];
				const leads = coords.filter((c) => c.seriesId === seriesId).map((c) => c.personId);
				const m = lateMessage({ ...info.ref, end: t.endDate, people: on.map((a) => a.name) });
				out.push(...rows([...on.map((a) => a.personId), ...(leads.length ? leads : admins.map((a) => a.id))], { seriesId, taskId: t.id, kind: 'late', dedupeKey: lateKey(t) }, m));
			}
			const saved = out.length ? await db.insert(notifications).values(out).onConflictDoNothing().returning({ id: notifications.id }) : [];
			late = saved.length;
		}
	}
	// Today's new late notices and any earlier email that failed, in one pass.
	const emailed = await deliver();
	return { today, workingDay: isWorkingDay(today), late, ...emailed };
}

/** Whether a person gets task emails (their own choice, from the account menu). */
export async function setEmailNotifications(personId: string, on: boolean) {
	await db.update(people).set({ emailNotifications: on ? 1 : 0 }).where(eq(people.id, personId));
}
