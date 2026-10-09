/**
 * Transferring the admin role (spec: Transferring the admin role). An admin starts a transfer
 * with their password and a fresh emailed code; the recipient accepts from the emailed link,
 * signed in; in one transaction they become admin and the sender takes the role they chose.
 * A pending transfer is voided if it expires, either person is deactivated, or the sender
 * stops being an admin.
 */
import { error } from '@sveltejs/kit';
import { and, eq, isNull, or, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { randomInt, timingSafeEqual } from 'node:crypto';
import { ulid } from 'ulid';
import { ORIGIN } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { activityLog, adminTransfers, people } from '#lib/server/db/schema.ts';
import { auth } from '#lib/server/auth.ts';
import { checkPassword, emailForUser } from '#lib/server/accounts.ts';
import { hashToken, newToken } from '#lib/server/tokens.ts';
import { sendEmail } from '#lib/server/email.ts';
import type { PersonCtx } from '#lib/server/api-auth.ts';
import { ROLE_LABEL } from '#lib/roles.ts';

export const TRANSFER_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_TRIES = 5;
const codeKey = (personId: string) => `admin-transfer:${personId}`;

type Transfer = typeof adminTransfers.$inferSelect;
type Person = typeof people.$inferSelect;

const person = (id: string) => db.select().from(people).where(eq(people.id, id)).then((r) => r[0] ?? null);
const emailOf = async (p: Person) => (p.userId ? await emailForUser(p.userId) : null) ?? p.email;

async function mail(p: Person, subject: string, text: string) {
	const to = await emailOf(p);
	if (!to) return;
	try {
		await sendEmail({ to, subject, text });
	} catch (e) {
		console.error('Admin transfer email failed', e);
	}
}

async function log(actorId: string | null, transferId: string, action: string, after: unknown) {
	await db.insert(activityLog).values({
		id: ulid(), seriesId: null, actorId, entity: 'admin_transfer', entityId: transferId, action,
		afterJson: JSON.stringify(after), createdAt: new Date().toISOString(),
	});
}

// ── The fresh code ──────────────────────────────────────────────────────────

/** Email the admin a 6-digit code for starting a transfer. Single use, 10 minutes. */
export async function sendTransferCode(actor: PersonCtx & { personRow: Person }) {
	if (actor.systemRole !== 'admin') throw error(403, 'Only an admin can transfer the admin role.');
	const email = await emailOf(actor.personRow);
	if (!email) throw error(409, 'Your account has no email address to send a code to.');
	const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
	const ctx = await auth.$context;
	await ctx.internalAdapter.deleteVerificationByIdentifier(codeKey(actor.personId));
	await ctx.internalAdapter.createVerificationValue({
		identifier: codeKey(actor.personId),
		value: `${hashToken(code)}:0`,
		expiresAt: new Date(Date.now() + CODE_TTL_MS),
	});
	await sendEmail({
		to: email,
		subject: 'Your code to transfer the admin role',
		text: `Your bookflow code to transfer the admin role is: ${code}\n\nIt expires in 10 minutes. If you did not ask for it, someone may know your password: change it.`,
	});
}

/** Check and use up the code; five wrong tries throw it away. */
async function useCode(personId: string, code: string) {
	const ctx = await auth.$context;
	const row = await ctx.internalAdapter.findVerificationValue(codeKey(personId));
	if (!row || new Date(row.expiresAt).getTime() < Date.now()) throw error(422, 'That code has expired. Send yourself a new one.');
	const [hash, tries] = row.value.split(':');
	const given = Buffer.from(hashToken(code.trim()));
	const ok = given.length === hash.length && timingSafeEqual(given, Buffer.from(hash));
	await ctx.internalAdapter.deleteVerificationByIdentifier(codeKey(personId));
	if (ok) return;
	if (Number(tries) + 1 < CODE_TRIES)
		await ctx.internalAdapter.createVerificationValue({ identifier: codeKey(personId), value: `${hash}:${Number(tries) + 1}`, expiresAt: new Date(row.expiresAt) });
	throw error(422, Number(tries) + 1 < CODE_TRIES ? 'That code is not right.' : 'Too many wrong codes. Send yourself a new one.');
}

// ── Voiding ─────────────────────────────────────────────────────────────────

/** Why a pending transfer can no longer happen, or null. */
function staleReason(t: Transfer, from: Pick<Person, 'active' | 'systemRole'> | null, to: Pick<Person, 'active'> | null, now: string) {
	return t.expiresAt < now ? 'expired'
		: !from?.active ? 'sender deactivated'
		: !to?.active ? 'recipient deactivated'
		: from.systemRole !== 'admin' ? 'sender no longer an admin'
		: null;
}

async function voidTransfer(t: Transfer, reason: string, now: string) {
	await db.update(adminTransfers).set({ cancelledAt: now }).where(eq(adminTransfers.id, t.id));
	await log(null, t.id, 'void', { reason });
}

const fromP = alias(people, 'from_p');
const toP = alias(people, 'to_p');

/** Pending transfers with both people, in one query; stale ones are voided on the way. */
async function pendingWithPeople(where?: SQL) {
	const rows = await db.select({ t: adminTransfers, from: fromP, to: toP }).from(adminTransfers)
		.innerJoin(fromP, eq(fromP.id, adminTransfers.fromPersonId)).innerJoin(toP, eq(toP.id, adminTransfers.toPersonId))
		.where(and(isNull(adminTransfers.acceptedAt), isNull(adminTransfers.cancelledAt), where));
	const now = new Date().toISOString();
	const live = [];
	for (const r of rows) {
		const reason = staleReason(r.t, r.from, r.to, now);
		if (reason) await voidTransfer(r.t, reason, now);
		else live.push(r);
	}
	return live;
}

/** Cancel pending transfers that can no longer happen, and say why. Safe to call often. */
export async function voidStaleTransfers() {
	await pendingWithPeople();
}

// ── Start, accept, cancel ───────────────────────────────────────────────────

export async function startTransfer(
	actor: PersonCtx & { personRow: Person },
	input: { toPersonId: string; senderNewRole: 'manager' | 'member'; password: string; code: string },
) {
	if (actor.systemRole !== 'admin') throw error(403, 'Only an admin can transfer the admin role.');
	await voidStaleTransfers();
	if (await pendingFrom(actor.personId)) throw error(409, 'You already have a transfer waiting. Cancel it first.');

	const to = await person(input.toPersonId);
	if (!to) throw error(404, 'Person not found');
	if (to.id === actor.personId) throw error(422, 'Choose someone other than yourself.');
	if (!to.active) throw error(409, `${to.displayName} is deactivated.`);
	if (!to.userId) throw error(409, `${to.displayName} has not accepted their invite yet, so they cannot sign in to accept.`);
	if (to.systemRole === 'admin') throw error(409, `${to.displayName} is already an admin.`);

	// The most powerful change in the app: password, then a fresh code.
	const email = await emailOf(actor.personRow);
	const pw = email ? await checkPassword(email, input.password) : { ok: false as const };
	if (!pw.ok) throw error(422, 'That password is not right.');
	await useCode(actor.personId, input.code);

	const token = newToken();
	const now = new Date();
	const row: Transfer = {
		id: ulid(), fromPersonId: actor.personId, toPersonId: to.id, senderNewRole: input.senderNewRole,
		tokenHash: hashToken(token), createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + TRANSFER_TTL_MS).toISOString(),
		acceptedAt: null, cancelledAt: null,
	};
	await db.insert(adminTransfers).values(row);
	await log(actor.personId, row.id, 'create', { to: to.id, toName: to.displayName, senderNewRole: row.senderNewRole, expiresAt: row.expiresAt });
	await mail(to, `${actor.personRow.displayName} wants to hand you the bookflow admin role`,
		`${actor.personRow.displayName} has asked to make you the bookflow admin. They will become ${ROLE_LABEL[row.senderNewRole]}.\n\n` +
		`As admin you can do everything across all series, including granting roles and managing holidays.\n\n` +
		`Sign in and accept or decline here:\n${ORIGIN}/admin-transfer/${token}\n\nThe link expires in 7 days. Nothing changes unless you accept.`);
	return { id: row.id, to: to.displayName, expiresAt: row.expiresAt };
}

export async function pendingFrom(personId: string) {
	return db.select().from(adminTransfers)
		.where(and(eq(adminTransfers.fromPersonId, personId), isNull(adminTransfers.acceptedAt), isNull(adminTransfers.cancelledAt)))
		.then((r) => r[0] ?? null);
}

/** The pending transfers this person sent or was offered, with names (for the People page and banner). One query. */
export async function pendingFor(personId: string) {
	const rows = await pendingWithPeople(or(eq(adminTransfers.fromPersonId, personId), eq(adminTransfers.toPersonId, personId)));
	return rows.map(({ t, from, to }) => ({ id: t.id, from: from.displayName, to: to.displayName, senderNewRole: t.senderNewRole, expiresAt: t.expiresAt, mine: t.fromPersonId === personId }));
}

/** Look a transfer up by its emailed token, voiding it first if it can no longer happen. */
export async function transferByToken(token: string) {
	await voidStaleTransfers();
	const t = await db.select().from(adminTransfers).where(eq(adminTransfers.tokenHash, hashToken(token))).then((r) => r[0] ?? null);
	if (!t) return null;
	const [from, to] = await Promise.all([person(t.fromPersonId), person(t.toPersonId)]);
	return { t, from, to, state: t.acceptedAt ? 'accepted' as const : t.cancelledAt ? 'cancelled' as const : 'pending' as const };
}

export async function acceptTransfer(viewer: PersonCtx, token: string) {
	const found = await transferByToken(token);
	if (!found) throw error(404, 'This transfer link is not valid.');
	const { t, from, to } = found;
	if (found.state !== 'pending' || !from || !to) throw error(410, found.state === 'accepted' ? 'This transfer was already accepted.' : 'This transfer was cancelled, declined or has expired.');
	if (viewer.personId !== t.toPersonId) throw error(403, `This transfer is for ${to.displayName}. Sign in as them to accept it.`);

	const now = new Date().toISOString();
	await db.transaction(async (tx) => {
		// Recipient first, so the app always has an admin.
		await tx.update(people).set({ systemRole: 'admin' }).where(eq(people.id, to.id));
		await tx.update(people).set({ systemRole: t.senderNewRole }).where(eq(people.id, from.id));
		await tx.update(adminTransfers).set({ acceptedAt: now }).where(eq(adminTransfers.id, t.id));
		for (const [p, role] of [[to, 'admin'], [from, t.senderNewRole]] as const)
			await tx.insert(activityLog).values({
				id: ulid(), seriesId: null, actorId: viewer.personId, entity: 'person', entityId: p.id, action: 'role',
				beforeJson: JSON.stringify({ systemRole: p.systemRole }), afterJson: JSON.stringify({ systemRole: role, via: 'admin_transfer' }), createdAt: now,
			});
		await tx.insert(activityLog).values({
			id: ulid(), seriesId: null, actorId: viewer.personId, entity: 'admin_transfer', entityId: t.id, action: 'accept',
			afterJson: JSON.stringify({ from: from.id, to: to.id, senderNewRole: t.senderNewRole }), createdAt: now,
		});
	});
	await mail(to, 'You are now the bookflow admin', `You accepted ${from.displayName}'s transfer. You are now the bookflow admin; ${from.displayName} is now ${ROLE_LABEL[t.senderNewRole]}.`);
	await mail(from, `${to.displayName} is now the bookflow admin`, `${to.displayName} accepted your transfer of the admin role. You are now ${ROLE_LABEL[t.senderNewRole]}.`);
	return { from: from.displayName, to: to.displayName, senderNewRole: t.senderNewRole };
}

/** The sender cancels, or the recipient declines. */
export async function cancelTransfer(viewer: PersonCtx, id: string) {
	const t = await db.select().from(adminTransfers).where(eq(adminTransfers.id, id)).then((r) => r[0] ?? null);
	if (!t) throw error(404, 'Transfer not found');
	const sender = viewer.personId === t.fromPersonId;
	if (!sender && viewer.personId !== t.toPersonId) throw error(403, 'Only the sender or the recipient can do that.');
	if (t.acceptedAt || t.cancelledAt) throw error(410, 'This transfer is no longer pending.');
	await db.update(adminTransfers).set({ cancelledAt: new Date().toISOString() }).where(eq(adminTransfers.id, id));
	await log(viewer.personId, id, sender ? 'cancel' : 'decline', {});
	const [from, to] = await Promise.all([person(t.fromPersonId), person(t.toPersonId)]);
	if (sender && to) await mail(to, 'An admin role transfer was cancelled', `${from?.displayName ?? 'The admin'} cancelled their transfer of the bookflow admin role to you. Nothing changed.`);
	if (!sender && from) await mail(from, `${to?.displayName ?? 'The recipient'} declined the admin role`, `${to?.displayName ?? 'The recipient'} declined your transfer of the bookflow admin role. You are still the admin.`);
	return { cancelled: true, by: sender ? 'sender' : 'recipient' };
}
