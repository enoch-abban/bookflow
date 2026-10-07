import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { books, invites, people, series, seriesMembers, tasks, windows } from '#lib/server/db/schema.ts';
import { requireCoord } from '#lib/server/api-auth.ts';
import { inviteState } from '#lib/server/invites.ts';

export const load: PageServerLoad = async ({ params, locals }) => {
	const me = await requireCoord(locals, params.series);

	const ser = await db.select().from(series).where(eq(series.id, params.series)).then((r) => r[0]);
	if (!ser) throw error(404, 'Series not found');

	const memberRows = await db
		.select({ member: seriesMembers, person: people })
		.from(seriesMembers)
		.innerJoin(people, eq(people.id, seriesMembers.personId))
		.where(eq(seriesMembers.seriesId, ser.id))
		.orderBy(asc(seriesMembers.teamLabel), asc(people.displayName));

	const memberIds = memberRows.map((r) => r.person.id);
	const inviteRows = memberIds.length
		? await db.select().from(invites).where(inArray(invites.personId, memberIds)).orderBy(desc(invites.createdAt))
		: [];
	const openInvite = new Map<string, (typeof inviteRows)[number]>();
	for (const inv of inviteRows)
		if (!openInvite.has(inv.personId) && inviteState(inv) === 'open') openInvite.set(inv.personId, inv);

	const members = memberRows.map(({ member, person }) => {
		const inv = openInvite.get(person.id);
		return {
			personId: person.id,
			displayName: person.displayName,
			email: inv?.email ?? person.email,
			role: member.role,
			teamLabel: member.teamLabel,
			capacity: member.capacity,
			status: !person.active ? 'deactivated' : person.userId ? 'active' : inv ? 'invited' : 'placeholder',
			invite: inv ? { id: inv.id, expiresAt: inv.expiresAt, invitedBy: inv.invitedBy } : null
		};
	});

	const others = await db
		.select({ id: people.id, displayName: people.displayName })
		.from(people)
		.where(eq(people.active, 1))
		.orderBy(asc(people.displayName))
		.then((rows) => rows.filter((p) => !memberIds.includes(p.id)));

	const windowRows = await db.select().from(windows).where(eq(windows.seriesId, ser.id)).orderBy(asc(windows.startDate));
	const taskCounts = await db
		.select({ windowId: tasks.windowId, n: count() })
		.from(tasks)
		.innerJoin(books, eq(books.id, tasks.bookId))
		.where(eq(books.seriesId, ser.id))
		.groupBy(tasks.windowId);
	const countBy = new Map(taskCounts.map((c) => [c.windowId, c.n]));
	const windowList = windowRows.map((w) => ({ ...w, taskCount: countBy.get(w.id) ?? 0 }));
	const unscheduled = await db
		.select({ n: count() })
		.from(tasks)
		.innerJoin(books, eq(books.id, tasks.bookId))
		.where(and(eq(books.seriesId, ser.id), eq(tasks.scheduleState, 'unscheduled')))
		.then((r) => r[0]?.n ?? 0);

	const teamLabels = [...new Set(members.map((m) => m.teamLabel).filter((l): l is string => !!l))].sort();

	return {
		series: ser,
		members,
		others,
		windows: windowList,
		unscheduled,
		teamLabels,
		me: { personId: me.personId, isAdmin: me.isAdmin }
	};
};
