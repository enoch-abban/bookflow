import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Kept free of SvelteKit imports so CLI scripts can use it too.

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Random URL-safe token. Only its hash is stored. */
export function newToken(): string {
	return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

/** `payload.signature`, signed with the app secret. */
export function sign(payload: string, secret: string): string {
	const sig = createHmac('sha256', secret).update(payload).digest('base64url');
	return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

/** Returns the payload if the signature matches, else null. */
export function unsign(value: string, secret: string): string | null {
	const [encoded, sig] = value.split('.');
	if (!encoded || !sig) return null;
	const payload = Buffer.from(encoded, 'base64url').toString();
	const expected = createHmac('sha256', secret).update(payload).digest();
	const given = Buffer.from(sig, 'base64url');
	if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
	return payload;
}
