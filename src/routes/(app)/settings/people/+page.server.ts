import type { PageServerLoad } from './$types';
import { asc, desc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { invites, people, series, seriesMembers } from '#lib/server/db/schema.ts';
import { requireAdmin } from '#lib/server/api-auth.ts';
import { inviteState } from '#lib/server/invites.ts';
import { pendingFor } from '#lib/server/admin-transfer.ts';

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

	// What the viewer may do to each person (the server checks again: lib/server/system-roles.ts).
	const activeAdmins = rows.filter((p) => p.systemRole === 'admin' && p.active).length;
	const iAmAdmin = me.systemRole === 'admin';

	const list = rows.map((p) => {
		const self = p.id === me.personId;
		const looksAfter = iAmAdmin || p.systemRole === 'member';
		const inv = latestInvite.get(p.id);
		const invState = inv ? inviteState(inv) : null;
		const status = !p.active ? 'deactivated' : p.userId ? 'active' : invState === 'open' ? 'invited' : 'placeholder';
		return {
			id: p.id,
			displayName: p.displayName,
			email: p.email,
			systemRole: p.systemRole,
			// Rename, reset password, deactivate or reactivate: admins anyone; managers members only.
			canEdit: looksAfter && !(self && !iAmAdmin),
			canDeactivate: looksAfter && !self && !(p.systemRole === 'admin' && p.active && activeAdmins <= 1),
			// Role menu: admins only; for themselves, only stepping down while another admin is active.
			canChangeRole: iAmAdmin && (!self || activeAdmins > 1),
			roleNote: iAmAdmin && self && activeAdmins <= 1 ? 'You are the only active admin.' : null,
			hasAccount: !!p.userId,
			status,
			invite: inv && invState === 'open' ? { id: inv.id, email: inv.email, expiresAt: inv.expiresAt } : null,
			lastInviteState: invState,
			memberships: memberRows.filter((m) => m.personId === p.id).map(({ seriesName, role, teamLabel }) => ({ seriesName, role, teamLabel }))
		};
	});

	// Transferring the admin role: an admin's pending transfer, and who could receive one
	// (active, signed up, not already an admin).
	const outgoing = iAmAdmin ? (await pendingFor(me.personId)).find((t) => t.mine) ?? null : null;
	const transferTo = iAmAdmin
		? rows.filter((p) => p.id !== me.personId && p.active && p.userId && p.systemRole !== 'admin').map((p) => ({ id: p.id, name: p.displayName }))
		: [];
	return { people: list, meId: me.personId, iAmAdmin, outgoing, transferTo };
};
