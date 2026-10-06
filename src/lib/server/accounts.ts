import { error, type Cookies } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { BETTER_AUTH_SECRET } from '$app/env/private';
import { auth } from '#lib/server/auth.ts';
import { db } from '#lib/server/db/index.ts';
import { people } from '#lib/server/db/schema.ts';
import { sign, unsign } from '#lib/server/tokens.ts';

const PENDING_COOKIE = 'bf_pending_login';
const PENDING_TTL_S = 10 * 60;

export type PasswordCheck =
	| { ok: true; email: string }
	| { ok: false; reason: 'invalid' | 'unverified' | 'inactive' | 'no_person' };

/** Check email + password without creating a session (first sign-in factor). */
export async function checkPassword(rawEmail: string, password: string): Promise<PasswordCheck> {
	const ctx = await auth.$context;
	const email = rawEmail.trim().toLowerCase();
	const found = await ctx.internalAdapter.findUserByEmail(email, { includeAccounts: true });
	const hash = found?.accounts.find((a) => a.providerId === 'credential')?.password;

	if (!found || !hash) {
		// Spend the same time as a real check so response time doesn't reveal which emails exist.
		await ctx.password.hash(password);
		return { ok: false, reason: 'invalid' };
	}
	if (!(await ctx.password.verify({ hash, password }))) return { ok: false, reason: 'invalid' };
	if (!found.user.emailVerified) return { ok: false, reason: 'unverified' };

	const person = await db.select().from(people).where(eq(people.userId, found.user.id)).then((r) => r[0]);
	if (!person) return { ok: false, reason: 'no_person' };
	if (!person.active) return { ok: false, reason: 'inactive' };
	return { ok: true, email };
}

/** Remember that the password step passed, so the code step may issue a session. */
export function setPendingLogin(cookies: Cookies, email: string) {
	const value = sign(`${email}|${Date.now() + PENDING_TTL_S * 1000}`, BETTER_AUTH_SECRET);
	cookies.set(PENDING_COOKIE, value, { path: '/login', httpOnly: true, sameSite: 'lax', maxAge: PENDING_TTL_S });
}

export function getPendingLogin(cookies: Cookies): string | null {
	const raw = cookies.get(PENDING_COOKIE);
	const payload = raw ? unsign(raw, BETTER_AUTH_SECRET) : null;
	if (!payload) return null;
	const [email, exp] = payload.split('|');
	return Number(exp) > Date.now() ? email : null;
}

export function clearPendingLogin(cookies: Cookies) {
	cookies.delete(PENDING_COOKIE, { path: '/login' });
}

/**
 * First half of accepting an invite: create an unverified account with the chosen
 * password and email a verification code. The person is linked once the code is
 * entered (see linkVerifiedUser).
 */
export async function createInvitedAccount(rawEmail: string, displayName: string, password: string) {
	const ctx = await auth.$context;
	const email = rawEmail.toLowerCase();

	const existing = await ctx.internalAdapter.findUserByEmail(email);
	if (existing) {
		if (existing.user.emailVerified) throw error(409, 'An account with this email already exists. Sign in instead.');
		// A previous attempt that never entered its code: start over with the new details.
		await ctx.internalAdapter.deleteUser(existing.user.id);
	}

	const user = await ctx.internalAdapter.createUser(
		{ email, name: displayName, emailVerified: false },
		{ method: 'email-password' }
	);
	await ctx.internalAdapter.createAccount({
		userId: user.id,
		providerId: 'credential',
		accountId: user.id,
		password: await ctx.password.hash(password)
	});
	await sendVerificationCode(email);
}

export async function sendVerificationCode(email: string) {
	await auth.api.sendVerificationOTP({ body: { email, type: 'email-verification' } });
}

/** True when an account exists for this email but its code hasn't been entered yet. */
export async function hasUnverifiedAccount(email: string) {
	const ctx = await auth.$context;
	const found = await ctx.internalAdapter.findUserByEmail(email.toLowerCase());
	return !!found && !found.user.emailVerified;
}

export async function endSessions(userId: string) {
	const ctx = await auth.$context;
	await ctx.internalAdapter.deleteUserSessions(userId);
}

export async function renameUser(userId: string, name: string) {
	const ctx = await auth.$context;
	await ctx.internalAdapter.updateUser(userId, { name });
}

export async function emailForUser(userId: string) {
	const ctx = await auth.$context;
	return (await ctx.internalAdapter.findUserById(userId))?.email ?? null;
}

/** Map Better Auth OTP errors to something a person can act on. */
export function otpErrorMessage(err: unknown): string {
	const code = (err as { body?: { code?: string } })?.body?.code ?? '';
	if (code.includes('TOO_MANY')) return 'Too many wrong codes. Request a new one.';
	if (code.includes('EXPIRED')) return 'That code has expired. Request a new one.';
	return 'That code is not right. Check the email and try again.';
}
