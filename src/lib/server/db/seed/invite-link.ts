// Run: npm run auth:invite -- <person id | current email | display name> <invite email>
//      npm run auth:invite -- --admin "<display name>" <email>
// Issues an invite link without sending email — used to bring in the first admin,
// since sign-up is invite-only and nobody can sign in to send the first invite.
// --admin starts from scratch: it creates the person as an admin (or makes the person with
// that email one) and invites them, and only while the app has no active admin.
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

const args = process.argv.slice(2);
const asAdmin = args[0] === '--admin';
const [who, rawEmail] = asAdmin ? args.slice(1) : args;
if (!who?.trim() || !rawEmail?.trim()) {
	console.error('Usage: npm run auth:invite -- <person id | current email | display name> <invite email>');
	console.error('       npm run auth:invite -- --admin "<display name>" <email>   (first admin, empty app)');
	process.exit(1);
}
const email = rawEmail.trim().toLowerCase();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
	console.error(`"${rawEmail}" is not an email address.`);
	process.exit(1);
}

const db = drizzle(createClient({ url: process.env.DATABASE_URL!, authToken: process.env.DATABASE_AUTH_TOKEN || undefined }));

let person: typeof people.$inferSelect;
if (asAdmin) {
	// Only for an app with no active admin: once there is one, they invite everyone else.
	const admins = await db.select({ name: people.displayName }).from(people)
		.where(and(eq(people.systemRole, 'admin'), eq(people.active, 1)));
	if (admins.length) {
		console.error(`This app already has an admin (${admins.map((a) => a.name).join(', ')}). Ask them to invite you from the People page.`);
		process.exit(1);
	}
	const existing = await db.select().from(people).where(eq(people.email, email)).then((r) => r[0]);
	if (existing?.userId) {
		console.error(`${existing.displayName} already has an account with ${email}; make them an admin from the People page or the database.`);
		process.exit(1);
	}
	const now = new Date().toISOString();
	if (existing) {
		// A placeholder with this email already: make them the admin.
		[person] = await db.update(people).set({ systemRole: 'admin', active: 1, displayName: who.trim() }).where(eq(people.id, existing.id)).returning();
		await db.insert(activityLog).values({
			id: ulid(), seriesId: null, actorId: null, entity: 'person', entityId: person.id, action: 'role',
			beforeJson: JSON.stringify({ systemRole: existing.systemRole }), afterJson: JSON.stringify({ systemRole: 'admin', via: 'cli' }), createdAt: now,
		});
	} else {
		[person] = await db.insert(people).values({ id: ulid(), displayName: who.trim(), email, systemRole: 'admin', active: 1 }).returning();
		await db.insert(activityLog).values({
			id: ulid(), seriesId: null, actorId: null, entity: 'person', entityId: person.id, action: 'create',
			afterJson: JSON.stringify({ displayName: person.displayName, systemRole: 'admin', via: 'cli' }), createdAt: now,
		});
	}
	console.log(`${person.displayName} is the admin.`);
} else {
	const matches = await db
		.select()
		.from(people)
		.where(or(eq(people.id, who), eq(people.email, who), eq(people.displayName, who)));
	if (matches.length !== 1) {
		console.error(matches.length ? `"${who}" matches ${matches.length} people; use the person id.` : `No person matches "${who}". On an empty app, use --admin.`);
		process.exit(1);
	}
	person = matches[0];
	if (person.userId) {
		console.error(`${person.displayName} already has an account.`);
		process.exit(1);
	}
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
