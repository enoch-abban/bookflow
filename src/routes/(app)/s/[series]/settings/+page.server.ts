import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { bookStageSkips, books, invites, people, series, seriesMembers, stages, stageTracks, tasks, tracks, windows } from '#lib/server/db/schema.ts';
import { requireCoord } from '#lib/server/api-auth.ts';
import { inviteState } from '#lib/server/invites.ts';
import { refreshHolidays } from '#lib/server/calendar-db.ts';

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

	// Pipeline: tracks with their stage sequence, stages and books with task counts.
	const [trackRows, stageRows, bookRows] = await Promise.all([
		db.select().from(tracks).where(eq(tracks.seriesId, ser.id)).orderBy(asc(tracks.sortOrder)),
		db.select().from(stages).where(eq(stages.seriesId, ser.id)).orderBy(asc(stages.sortOrder)),
		db.select().from(books).where(eq(books.seriesId, ser.id)).orderBy(asc(books.sortOrder))
	]);
	const links = stageRows.length
		? await db.select().from(stageTracks).where(inArray(stageTracks.stageId, stageRows.map((s) => s.id)))
		: [];
	const taskStats = await db
		.select({ stageId: tasks.stageId, bookId: tasks.bookId, n: count() })
		.from(tasks)
		.innerJoin(books, eq(books.id, tasks.bookId))
		.where(eq(books.seriesId, ser.id))
		.groupBy(tasks.stageId, tasks.bookId);
	const skipRows = bookRows.length
		? await db.select().from(bookStageSkips).where(inArray(bookStageSkips.bookId, bookRows.map((b) => b.id)))
		: [];
	const sum = (pick: (r: (typeof taskStats)[number]) => boolean) => taskStats.filter(pick).reduce((a, r) => a + r.n, 0);
	const trackName = new Map(trackRows.map((t) => [t.id, t.name]));
	// Archived stages and books keep Done work as history; they are listed separately.
	const liveStages = stageRows.filter((s) => !s.archivedAt);
	const liveBooks = bookRows.filter((b) => !b.archivedAt);
	const pipeline = {
		archived: {
			stages: stageRows.filter((s) => s.archivedAt).map((s) => ({ id: s.id, name: s.name, archivedAt: s.archivedAt! })),
			books: bookRows.filter((b) => b.archivedAt).map((b) => ({ id: b.id, code: b.code, name: b.name, archivedAt: b.archivedAt! }))
		},
		tracks: trackRows.map((t) => ({ ...t, bookCount: liveBooks.filter((b) => b.trackId === t.id).length, stageIds: liveStages.filter((s) => links.some((l) => l.stageId === s.id && l.trackId === t.id)).map((s) => s.id) })),
		stages: liveStages.map((s) => ({
			...s,
			trackNames: trackRows.filter((t) => links.some((l) => l.stageId === s.id && l.trackId === t.id)).map((t) => t.name),
			taskCount: sum((r) => r.stageId === s.id)
		})),
		books: liveBooks.map((b) => ({
			...b,
			trackName: trackName.get(b.trackId) ?? '',
			taskCount: sum((r) => r.bookId === b.id),
			skippedStageIds: skipRows.filter((k) => k.bookId === b.id).map((k) => k.stageId)
		}))
	};

	const teamLabels = [...new Set(members.map((m) => m.teamLabel).filter((l): l is string => !!l))].sort();

	return {
		series: ser,
		members,
		others,
		windows: windowList,
		holidays: (await refreshHolidays()).map((h) => h.date),
		pipeline,
		unscheduled,
		teamLabels,
		me: { personId: me.personId, isAdmin: me.isAdmin }
	};
};
