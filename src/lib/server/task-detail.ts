/**
 * Everything the task drawer shows (spec: Task drawer): the task, its book and stage,
 * assignees (lead marked), the series' members with their workload over the task's dates,
 * links, comments and activity, and what the viewer may change.
 */
import { error } from '@sveltejs/kit';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	activityLog, books, dependencies, people, series, seriesMembers, stages, taskAssignees, taskComments, tasks, windows,
} from '#lib/server/db/schema.ts';
import { refreshHolidays } from '#lib/server/calendar-db.ts';
import { isWorkingDay } from '#lib/schedule/calendar.ts';
import { summarize, workload } from '#lib/schedule/workload.ts';
import { describe as describeEntry } from '#lib/activity/describe.ts';
import { namesFor } from '#lib/server/history.ts';
import { reviewersOf } from '#lib/server/reviews.ts';
import { resolvePerson } from '#lib/server/api-auth.ts';

const ALLOWED: Record<string, string[]> = {
	not_started: ['in_progress', 'blocked'],
	in_progress: ['in_review', 'done', 'blocked'],
	in_review: ['blocked'],
	returned: ['in_progress', 'blocked'],
	blocked: ['not_started', 'in_progress', 'in_review', 'returned'],
	done: [],
};

function workingDays(from: string, to: string): string[] {
	const out: string[] = [];
	const d = new Date(from + 'T12:00:00Z');
	for (let i = 0; i < 400; i++) {
		const iso = d.toISOString().slice(0, 10);
		if (iso > to) break;
		if (isWorkingDay(iso)) out.push(iso);
		d.setUTCDate(d.getUTCDate() + 1);
	}
	return out;
}

export async function taskDetail(locals: App.Locals, taskId: string) {
	const { personId, isAdmin } = await resolvePerson(locals);
	const row = await db.select({ t: tasks, b: books, s: stages }).from(tasks)
		.innerJoin(books, eq(books.id, tasks.bookId)).innerJoin(stages, eq(stages.id, tasks.stageId))
		.where(eq(tasks.id, taskId)).then((r) => r[0]);
	if (!row) throw error(404, 'Task not found');
	const { t, b, s } = row;
	const ser = await db.select().from(series).where(eq(series.id, b.seriesId)).then((r) => r[0]);
	const me = await db.select({ role: seriesMembers.role }).from(seriesMembers)
		.where(and(eq(seriesMembers.seriesId, ser.id), eq(seriesMembers.personId, personId))).then((r) => r[0]);
	if (!isAdmin && !me) throw error(403, 'Not a series member');
	await refreshHolidays();

	const [assigneeRows, memberRows, depRows, commentRows, windowRow] = await Promise.all([
		db.select({ personId: taskAssignees.personId, isLead: taskAssignees.isLead, name: people.displayName })
			.from(taskAssignees).innerJoin(people, eq(people.id, taskAssignees.personId)).where(eq(taskAssignees.taskId, t.id)),
		db.select({ personId: seriesMembers.personId, team: seriesMembers.teamLabel, capacity: seriesMembers.capacity, role: seriesMembers.role, name: people.displayName, active: people.active })
			.from(seriesMembers).innerJoin(people, eq(people.id, seriesMembers.personId)).where(eq(seriesMembers.seriesId, ser.id)),
		db.select().from(dependencies).where(or(eq(dependencies.predecessorId, t.id), eq(dependencies.successorId, t.id))),
		db.select({ c: taskComments, name: people.displayName }).from(taskComments)
			.innerJoin(people, eq(people.id, taskComments.authorId)).where(eq(taskComments.taskId, t.id)).orderBy(desc(taskComments.createdAt)),
		t.windowId ? db.select({ label: windows.label }).from(windows).where(eq(windows.id, t.windowId)).then((r) => r[0] ?? null) : null,
	]);

	const isCoord = isAdmin || me?.role === 'coordinator';
	const isAssignee = assigneeRows.some((a) => a.personId === personId);
	const reviewers = await reviewersOf(t);
	const reviewed = reviewers.reviewerTasks.length > 0;
	const canReview = t.status === 'in_review' && (isCoord || reviewers.people.some((p) => p.id === personId));

	// Status moves the viewer may make here: the transition rules, less the moves that go
	// through review (Approve/Return) or the print approval, and those the review loop forbids.
	let statusOptions: string[] = [];
	if ((isCoord || isAssignee) && s.category !== 'gate')
		statusOptions = (ALLOWED[t.status] ?? []).filter((to) => !(to === 'in_review' && !reviewed) && !(to === 'done' && t.status === 'in_progress' && reviewed));

	// Linked tasks with their names; the whole series' tasks for adding a link (coordinators only).
	const seriesTasks = await db.select({ id: tasks.id, code: books.code, stage: stages.name, status: tasks.status, startDate: tasks.startDate, endDate: tasks.endDate, sort: stages.sortOrder, bookSort: books.sortOrder })
		.from(tasks).innerJoin(books, eq(books.id, tasks.bookId)).innerJoin(stages, eq(stages.id, tasks.stageId))
		.where(eq(books.seriesId, ser.id));
	const byId = new Map(seriesTasks.map((x) => [x.id, x]));
	const link = (depId: string, otherId: string, lagDays: number) => {
		const o = byId.get(otherId);
		return { depId, taskId: otherId, label: o ? `${o.code} ${o.stage}` : 'a task', status: o?.status ?? '', startDate: o?.startDate ?? '', endDate: o?.endDate ?? '', lagDays };
	};
	const predecessors = depRows.filter((d) => d.successorId === t.id).map((d) => link(d.id, d.predecessorId, d.lagDays));
	const successors = depRows.filter((d) => d.predecessorId === t.id).map((d) => link(d.id, d.successorId, d.lagDays));
	const linked = new Set([t.id, ...predecessors.map((p) => p.taskId), ...successors.map((p) => p.taskId)]);
	const linkable = isCoord
		? seriesTasks.filter((x) => !linked.has(x.id)).sort((a, z) => a.bookSort - z.bookSort || a.sort - z.sort).map((x) => ({ id: x.id, label: `${x.code} ${x.stage}` }))
		: [];

	// Each member's load over this task's working days, not counting this task.
	const days = t.scheduleState === 'scheduled' ? workingDays(t.startDate, t.endDate) : [];
	let members = memberRows.filter((m) => m.active).map((m) => ({ personId: m.personId, name: m.name, team: m.team || 'No team', capacity: m.capacity, peak: 0, busyDays: 0, overDays: 0 }));
	if (days.length) {
		const others = await db.select({ id: tasks.id, startDate: tasks.startDate, endDate: tasks.endDate, durationDays: tasks.durationDays, status: tasks.status, scheduleState: tasks.scheduleState })
			.from(tasks).innerJoin(books, eq(books.id, tasks.bookId))
			.where(and(eq(books.seriesId, ser.id)));
		const near = others.filter((o) => o.id !== t.id && o.startDate <= days.at(-1)! && o.endDate >= days[0]);
		const as = near.length ? await db.select({ taskId: taskAssignees.taskId, personId: taskAssignees.personId }).from(taskAssignees).where(inArray(taskAssignees.taskId, near.map((o) => o.id))) : [];
		const grid = workload(near, as, days);
		members = members.map((m) => {
			const row_ = grid.get(m.personId);
			const sum = summarize(row_, m.capacity);
			// overDays: days on which this task would take them past their capacity.
			return { ...m, peak: sum.peak, busyDays: row_?.size ?? 0, overDays: [...(row_?.values() ?? [])].filter((c) => c.load + 1 > m.capacity).length };
		});
	}
	members.sort((a, z) => a.team.localeCompare(z.team) || a.name.localeCompare(z.name));

	// This task's history: its own entries and its reviews (comments are listed separately).
	const logRows = await db.select().from(activityLog)
		.where(and(eq(activityLog.entityId, t.id), inArray(activityLog.entity, ['task', 'review'])))
		.orderBy(desc(activityLog.id)).limit(30);
	const entries = logRows.map((r) => ({ id: r.id, entity: r.entity, entityId: r.entityId, action: r.action, before: r.beforeJson ? JSON.parse(r.beforeJson) : null, after: r.afterJson ? JSON.parse(r.afterJson) : null }));
	const names = await namesFor(ser.id, entries);
	const actorIds = [...new Set(logRows.map((r) => r.actorId).filter((x): x is string => !!x))];
	const actors = actorIds.length ? await db.select({ id: people.id, name: people.displayName }).from(people).where(inArray(people.id, actorIds)) : [];
	const activity = logRows.map((r, i) => ({
		id: r.id, at: r.createdAt, actor: actors.find((a) => a.id === r.actorId)?.name ?? 'System', line: describeEntry(entries[i], names),
	}));

	return {
		task: {
			id: t.id, title: t.title, status: t.status, iteration: t.iteration, startDate: t.startDate, endDate: t.endDate,
			durationDays: t.durationDays, scheduleState: t.scheduleState, window: windowRow?.label ?? null,
			overflowAllowed: !!t.overflowAllowed, feedbackUrl: t.feedbackUrl, notes: t.notes, blockedReason: t.blockedReason,
			dueDate: t.dueDate, version: t.version,
		},
		book: { id: b.id, code: b.code, name: b.name },
		stage: { id: s.id, name: s.name, key: s.key, category: s.category, isReview: !!s.isReview },
		series: { id: ser.id, name: ser.name, enforceWindows: !!ser.enforceWindows, windowOverflowDays: ser.windowOverflowDays },
		assignees: assigneeRows.sort((a, z) => z.isLead - a.isLead || a.name.localeCompare(z.name)).map((a) => ({ personId: a.personId, name: a.name, isLead: !!a.isLead })),
		members, workDays: days.length,
		predecessors, successors, linkable,
		comments: commentRows.map((c) => ({ id: c.c.id, author: c.name, body: c.c.body, at: c.c.createdAt })),
		activity,
		reviewers: reviewers.people.map((p) => p.name),
		viewer: { personId, isCoord, isAssignee, canReview, canComment: true },
		statusOptions,
	};
}
export type TaskDetail = Awaited<ReturnType<typeof taskDetail>>;
