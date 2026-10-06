import type { PageServerLoad } from './$types';
import { asc, desc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { invites, people, series, seriesMembers } from '#lib/server/db/schema.ts';
import { requireAdmin } from '#lib/server/api-auth.ts';
import { inviteState } from '#lib/server/invites.ts';

export const load: PageServerLoad = async ({ locals }) => {
	const me = await requireAdmin(locals);

	const [rows, inviteRows, memberRows] = await Promise.all([
		db.select().from(people).orderBy(asc(people.displayName)),
		db.select().from(invites).orderBy(desc(invites.createdAt)),
		db
			.select({ personId: seriesMembers.personId, seriesName: series.name, role: seriesMembers.role, teamLabel: seriesMembers.teamLabel })
			.from(seriesMembers)
			.innerJoin(series, eq(series.id, seriesMembers.seriesId))
	]);

	// Latest invite per person (rows are newest first).
	const latestInvite = new Map<string, (typeof inviteRows)[number]>();
	for (const inv of inviteRows) if (!latestInvite.has(inv.personId)) latestInvite.set(inv.personId, inv);

	const list = rows.map((p) => {
		const inv = latestInvite.get(p.id);
		const invState = inv ? inviteState(inv) : null;
		const status = !p.active ? 'deactivated' : p.userId ? 'active' : invState === 'open' ? 'invited' : 'placeholder';
		return {
			id: p.id,
			displayName: p.displayName,
			email: p.email,
			isAdmin: !!p.isAdmin,
			hasAccount: !!p.userId,
			status,
			invite: inv && invState === 'open' ? { id: inv.id, email: inv.email, expiresAt: inv.expiresAt } : null,
			lastInviteState: invState,
			memberships: memberRows.filter((m) => m.personId === p.id).map(({ seriesName, role, teamLabel }) => ({ seriesName, role, teamLabel }))
		};
	});

	return { people: list, meId: me.personId };
};
