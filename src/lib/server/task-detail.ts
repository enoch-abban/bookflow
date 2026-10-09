/**
 * Everything the task drawer shows (spec: Task drawer): the task, its book and stage,
 * assignees (lead marked), the series' members with their workload over the task's dates,
 * links, comments and activity, and what the viewer may change.
 */
import { error } from '@sveltejs/kit';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	activityLog, books, dependencies, people, series, seriesMembers, stages, taskAssignees, taskComments, tasks, windows,
} from '#lib/server/db/schema.ts';
import { refreshHolidays } from '#lib/server/calendar-db.ts';
import { isWorkingDay } from '#lib/schedule/calendar.ts';
import { summarize, workload } from '#lib/schedule/workload.ts';
import { describe as describeEntry, type Names } from '#lib/activity/describe.ts';
import { findReviewerTasks } from '#lib/server/reviews.ts';
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
	// 1. The task, its book, stage and series, and the viewer's role there: one query.
	const row = await db.select({ t: tasks, b: books, s: stages, ser: series, myRole: seriesMembers.role }).from(tasks)
		.innerJoin(books, eq(books.id, tasks.bookId)).innerJoin(stages, eq(stages.id, tasks.stageId))
		.innerJoin(series, eq(series.id, books.seriesId))
		.leftJoin(seriesMembers, and(eq(seriesMembers.seriesId, books.seriesId), eq(seriesMembers.personId, personId)))
		.where(eq(tasks.id, taskId)).then((r) => r[0]);
	if (!row) throw error(404, 'Task not found');
	const { t, b, s, ser } = row;
	if (!isAdmin && !row.myRole) throw error(403, 'Not a series member');
	await refreshHolidays();

	// 2. Everything else in one round trip: members, the series' tasks, links and assignees
	//    (for links, reviewers and workload), comments, the window and this task's history.
	const [memberRows, seriesTasks, seriesDeps, seriesAssignees, commentRows, windowRows, logRows] = await db.batch([
		db.select({ personId: seriesMembers.personId, team: seriesMembers.teamLabel, capacity: seriesMembers.capacity, name: people.displayName, active: people.active })
			.from(seriesMembers).innerJoin(people, eq(people.id, seriesMembers.personId)).where(eq(seriesMembers.seriesId, ser.id)),
		db.select({
			id: tasks.id, bookId: tasks.bookId, code: books.code, stage: stages.name, isReview: stages.isReview, status: tasks.status,
			startDate: tasks.startDate, endDate: tasks.endDate, durationDays: tasks.durationDays, scheduleState: tasks.scheduleState,
			sort: stages.sortOrder, bookSort: books.sortOrder,
		}).from(tasks).innerJoin(books, eq(books.id, tasks.bookId)).innerJoin(stages, eq(stages.id, tasks.stageId)).where(eq(books.seriesId, ser.id)),
		db.select({ id: dependencies.id, predecessorId: dependencies.predecessorId, successorId: dependencies.successorId, lagDays: dependencies.lagDays })
			.from(dependencies).innerJoin(tasks, eq(tasks.id, dependencies.successorId)).innerJoin(books, eq(books.id, tasks.bookId)).where(eq(books.seriesId, ser.id)),
		db.select({ taskId: taskAssignees.taskId, personId: taskAssignees.personId, isLead: taskAssignees.isLead, name: people.displayName })
			.from(taskAssignees).innerJoin(people, eq(people.id, taskAssignees.personId))
			.innerJoin(tasks, eq(tasks.id, taskAssignees.taskId)).innerJoin(books, eq(books.id, tasks.bookId)).where(eq(books.seriesId, ser.id)),
		db.select({ c: taskComments, name: people.displayName }).from(taskComments)
			.innerJoin(people, eq(people.id, taskComments.authorId)).where(eq(taskComments.taskId, t.id)).orderBy(desc(taskComments.createdAt)),
		db.select({ label: windows.label }).from(windows).where(eq(windows.id, t.windowId ?? '')),
		db.select({ log: activityLog, actor: people.displayName }).from(activityLog).leftJoin(people, eq(people.id, activityLog.actorId))
			.where(and(eq(activityLog.entityId, t.id), inArray(activityLog.entity, ['task', 'review'])))
			.orderBy(desc(activityLog.id)).limit(30),
	]);

	const assigneeRows = seriesAssignees.filter((a) => a.taskId === t.id);
	const depRows = seriesDeps.filter((d) => d.predecessorId === t.id || d.successorId === t.id);
	const byId = new Map(seriesTasks.map((x) => [x.id, x]));

	const isCoord = isAdmin || row.myRole === 'coordinator';
	const isAssignee = assigneeRows.some((a) => a.personId === personId);
	// Reviewers: the next review stage's assignees in this book, from the rows already loaded.
	const bookTasks = new Map(seriesTasks.filter((x) => x.bookId === t.bookId).map((x) => [x.id, { t: x, isReview: x.isReview }]));
	const reviewerTaskIds = findReviewerTasks(t.id, bookTasks, seriesDeps).map((x) => x.id);
	const reviewerPeople = [...new Map(seriesAssignees.filter((a) => reviewerTaskIds.includes(a.taskId)).map((a) => [a.personId, { id: a.personId, name: a.name }])).values()];
	const reviewed = reviewerTaskIds.length > 0;
	const canReview = t.status === 'in_review' && (isCoord || reviewerPeople.some((p) => p.id === personId));

	// Status moves the viewer may make here: the transition rules, less the moves that go
	// through review (Approve/Return) or the print approval, and those the review loop forbids.
	let statusOptions: string[] = [];
	if ((isCoord || isAssignee) && s.category !== 'gate')
		statusOptions = (ALLOWED[t.status] ?? []).filter((to) => !(to === 'in_review' && !reviewed) && !(to === 'done' && t.status === 'in_progress' && reviewed));

	// Linked tasks with their names; the whole series' tasks for adding a link (coordinators only).
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
		const near = seriesTasks.filter((o) => o.id !== t.id && o.startDate <= days.at(-1)! && o.endDate >= days[0]);
		const nearIds = new Set(near.map((o) => o.id));
		const grid = workload(near, seriesAssignees.filter((a) => nearIds.has(a.taskId)), days);
		members = members.map((m) => {
			const row_ = grid.get(m.personId);
			const sum = summarize(row_, m.capacity);
			// overDays: days on which this task would take them past their capacity.
			return { ...m, peak: sum.peak, busyDays: row_?.size ?? 0, overDays: [...(row_?.values() ?? [])].filter((c) => c.load + 1 > m.capacity).length };
		});
	}
	members.sort((a, z) => a.team.localeCompare(z.team) || a.name.localeCompare(z.name));

	// This task's history (its own entries and its reviews), named from the rows above.
	const entries = logRows.map(({ log: r }) => ({ id: r.id, entity: r.entity, entityId: r.entityId, action: r.action, before: r.beforeJson ? JSON.parse(r.beforeJson) : null, after: r.afterJson ? JSON.parse(r.afterJson) : null }));
	const personName = new Map(memberRows.map((m) => [m.personId, m.name]));
	const names: Names = {
		task: (id) => { const o = byId.get(id); return o ? `${o.code} ${o.stage}` : undefined; },
		book: () => b.code, stage: () => s.name, track: () => undefined, window: () => windowRows[0]?.label,
		person: (id) => personName.get(id),
	};
	const activity = logRows.map(({ log: r, actor }, i) => ({
		id: r.id, at: r.createdAt, actor: actor ?? 'System', line: describeEntry(entries[i], names),
	}));
	const windowRow = windowRows[0] ?? null;
	const reviewers = { people: reviewerPeople };

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
