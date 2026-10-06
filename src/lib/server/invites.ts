import { error } from '@sveltejs/kit';
import { and, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { ulid } from 'ulid';
import { ORIGIN } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { activityLog, invites, people } from '#lib/server/db/schema.ts';
import { sendInviteEmail } from '#lib/server/email.ts';
import { INVITE_TTL_MS, hashToken, newToken } from '#lib/server/tokens.ts';

type Invite = typeof invites.$inferSelect;
type Person = typeof people.$inferSelect;

export function inviteState(inv: Pick<Invite, 'acceptedAt' | 'revokedAt' | 'expiresAt'>) {
	if (inv.acceptedAt) return 'accepted' as const;
	if (inv.revokedAt) return 'revoked' as const;
	if (inv.expiresAt <= new Date().toISOString()) return 'expired' as const;
	return 'open' as const;
}

/** Look up an invite by its raw token. Throws 404/410 unless it is open and the person can still accept. */
export async function requireOpenInvite(token: string): Promise<{ invite: Invite; person: Person }> {
	const row = await db
		.select({ invite: invites, person: people })
		.from(invites)
		.innerJoin(people, eq(people.id, invites.personId))
		.where(eq(invites.tokenHash, hashToken(token)))
		.then((r) => r[0] ?? null);

	if (!row) throw error(404, 'This invite link is not valid.');
	const state = inviteState(row.invite);
	if (state === 'accepted') throw error(410, 'This invite has already been used. Sign in instead.');
	if (state === 'revoked') throw error(410, 'This invite was withdrawn. Ask your coordinator for a new one.');
	if (state === 'expired') throw error(410, 'This invite has expired. Ask your coordinator for a new one.');
	if (!row.person.active || row.person.userId) throw error(410, 'This invite can no longer be used.');
	return row;
}

/** Create an invite for a placeholder person, voiding any earlier open one, and email the link. */
export async function issueInvite(opts: { person: Person; email: string; inviter: Person }) {
	const { person, inviter } = opts;
	const email = opts.email.trim().toLowerCase();

	if (!person.active) throw error(409, 'Reactivate this person before inviting them.');
	if (person.userId) throw error(409, 'This person already has an account.');

	const clash = await db
		.select({ id: people.id })
		.from(people)
		.where(and(sql`lower(${people.email}) = ${email}`, ne(people.id, person.id)))
		.then((r) => r[0]);
	if (clash) throw error(409, 'Another person already uses this email.');

	const token = newToken();
	const now = new Date();
	const id = ulid();

	const invite = await db.transaction(async (tx) => {
		const voided = await tx
			.update(invites)
			.set({ revokedAt: now.toISOString() })
			.where(and(eq(invites.personId, person.id), isNull(invites.acceptedAt), isNull(invites.revokedAt)))
			.returning({ id: invites.id });

		const [row] = await tx
			.insert(invites)
			.values({
				id,
				personId: person.id,
				email,
				tokenHash: hashToken(token),
				invitedBy: inviter.id,
				createdAt: now.toISOString(),
				expiresAt: new Date(now.getTime() + INVITE_TTL_MS).toISOString()
			})
			.returning();

		await tx.insert(activityLog).values({
			id: ulid(),
			seriesId: null,
			actorId: inviter.id,
			entity: 'invite',
			entityId: id,
			action: voided.length ? 'resend' : 'create',
			afterJson: JSON.stringify({ personId: person.id, email, voided: voided.map((v) => v.id) }),
			createdAt: now.toISOString()
		});
		return row;
	});

	await sendInviteEmail(email, `${ORIGIN}/invite/${token}`, inviter.displayName);
	return publicInvite(invite);
}

export async function revokeInvite(invite: Invite, actor: Person) {
	if (inviteState(invite) !== 'open') throw error(409, 'Only open invites can be revoked.');
	const now = new Date().toISOString();
	await db.transaction(async (tx) => {
		await tx.update(invites).set({ revokedAt: now }).where(eq(invites.id, invite.id));
		await tx.insert(activityLog).values({
			id: ulid(),
			seriesId: null,
			actorId: actor.id,
			entity: 'invite',
			entityId: invite.id,
			action: 'revoke',
			createdAt: now
		});
	});
}

/**
 * Called by Better Auth once an address is verified with the emailed code.
 * Links the new account to the invited person so their assigned work carries over.
 */
export async function linkVerifiedUser(user: { id: string; email: string; name: string }) {
	const email = user.email.toLowerCase();
	const now = new Date().toISOString();

	const already = await db.select({ id: people.id }).from(people).where(eq(people.userId, user.id)).then((r) => r[0]);
	if (already) return;

	const invite = await db
		.select()
		.from(invites)
		.where(and(eq(invites.email, email), isNull(invites.acceptedAt), isNull(invites.revokedAt), gt(invites.expiresAt, now)))
		.orderBy(desc(invites.createdAt))
		.limit(1)
		.then((r) => r[0]);
	if (!invite) throw error(410, 'The invite for this email is no longer open.');

	await db.transaction(async (tx) => {
		await tx
			.update(people)
			.set({ userId: user.id, email, displayName: user.name })
			.where(and(eq(people.id, invite.personId), isNull(people.userId)));
		await tx.update(invites).set({ acceptedAt: now }).where(eq(invites.id, invite.id));
		await tx.insert(activityLog).values({
			id: ulid(),
			seriesId: null,
			actorId: invite.personId,
			entity: 'invite',
			entityId: invite.id,
			action: 'accept',
			afterJson: JSON.stringify({ personId: invite.personId, displayName: user.name }),
			createdAt: now
		});
	});
}

/** Invite fields safe to return to clients (no token hash). */
export function publicInvite(inv: Invite) {
	return {
		id: inv.id,
		personId: inv.personId,
		email: inv.email,
		invitedBy: inv.invitedBy,
		createdAt: inv.createdAt,
		expiresAt: inv.expiresAt,
		state: inviteState(inv)
	};
}
