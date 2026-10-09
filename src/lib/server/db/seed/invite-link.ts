// Run: npm run auth:invite -- <person id | current email | display name> <invite email>
// Issues an invite link without sending email — used to bring in the first admin,
// since sign-up is invite-only and nobody can sign in to send the first invite.
import { readFileSync } from 'node:fs';

try {
	for (const line of readFileSync('.env', 'utf8').split('\n')) {
		const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)/);
		if (m) (process.env as Record<string, string>)[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, '');
	}
} catch { /* .env not found — rely on process.env */ }

import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { and, eq, isNull, or } from 'drizzle-orm';
import { ulid } from 'ulid';
import { activityLog, invites, people } from '../schema.ts';
import { INVITE_TTL_MS, hashToken, newToken } from '../../tokens.ts';

const [who, rawEmail] = process.argv.slice(2);
if (!who || !rawEmail) {
	console.error('Usage: npm run auth:invite -- <person id | email | display name> <invite email>');
	process.exit(1);
}
const email = rawEmail.trim().toLowerCase();

const db = drizzle(createClient({ url: process.env.DATABASE_URL!, authToken: process.env.DATABASE_AUTH_TOKEN || undefined }));

const matches = await db
	.select()
	.from(people)
	.where(or(eq(people.id, who), eq(people.email, who), eq(people.displayName, who)));
if (matches.length !== 1) {
	console.error(matches.length ? `"${who}" matches ${matches.length} people; use the person id.` : `No person matches "${who}".`);
	process.exit(1);
}
const person = matches[0];
if (person.userId) {
	console.error(`${person.displayName} already has an account.`);
	process.exit(1);
}

const token = newToken();
const now = new Date();
const id = ulid();

await db.transaction(async (tx) => {
	await tx
		.update(invites)
		.set({ revokedAt: now.toISOString() })
		.where(and(eq(invites.personId, person.id), isNull(invites.acceptedAt), isNull(invites.revokedAt)));
	await tx.insert(invites).values({
		id,
		personId: person.id,
		email,
		tokenHash: hashToken(token),
		invitedBy: person.id,
		createdAt: now.toISOString(),
		expiresAt: new Date(now.getTime() + INVITE_TTL_MS).toISOString()
	});
	await tx.insert(activityLog).values({
		id: ulid(),
		seriesId: null,
		actorId: null,
		entity: 'invite',
		entityId: id,
		action: 'create',
		afterJson: JSON.stringify({ personId: person.id, email, via: 'cli' }),
		createdAt: now.toISOString()
	});
});

const origin = process.env.ORIGIN || 'http://localhost:5173';
console.log(`Invite for ${person.displayName}${person.systemRole !== 'member' ? ` (${person.systemRole})` : ''} <${email}>, valid 7 days:`);
console.log(`${origin}/invite/${token}`);
