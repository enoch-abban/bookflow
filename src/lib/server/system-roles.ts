/**
 * Applying account changes (spec: Users, roles and permissions; Granting admin and manager).
 * The rules themselves live in lib/roles.ts (personChangeRefusal), shared with the People page.
 */
import { error } from '@sveltejs/kit';
import { and, eq, ne } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { people } from '#lib/server/db/schema.ts';
import type { PersonCtx } from '#lib/server/api-auth.ts';
import { ROLE_LABEL, ROLE_SUMMARY, personChangeRefusal, type PersonChange, type SystemRole } from '#lib/roles.ts';
import { sendEmail } from '#lib/server/email.ts';
import { emailForUser } from '#lib/server/accounts.ts';

type Person = typeof people.$inferSelect;


async function otherActiveAdmins(personId: string) {
	return db.select({ id: people.id }).from(people)
		.where(and(eq(people.systemRole, 'admin'), eq(people.active, 1), ne(people.id, personId)))
		.then((r) => r.length);
}

/** Throws the 403 or 409 that stops this change, if any. */
export async function checkPersonChange(actor: PersonCtx, target: Person, change: PersonChange) {
	const refusal = personChangeRefusal(actor, target, change, await otherActiveAdmins(target.id));
	if (refusal) throw error(refusal.status, refusal.message);
}

/** Tell the person their app-wide role changed (best effort: a mail failure never undoes it). */
export async function notifyRoleChange(target: Person, from: SystemRole, to: SystemRole, actorName: string) {
	const to_ = (target.userId ? await emailForUser(target.userId) : null) ?? target.email;
	if (!to_) return;
	const label = (r: SystemRole) => ROLE_LABEL[r];
	try {
		await sendEmail({
			to: to_,
			subject: `Your bookflow role is now ${label(to)}`,
			text: `Hello ${target.displayName},\n\n${actorName} changed your bookflow role from ${label(from)} to ${label(to)}.\n\n${label(to)}: ${ROLE_SUMMARY[to]}\n\nThe change applies the next time you open or refresh a page; you stay signed in.\n`,
		});
	} catch (e) {
		console.error('Role change email failed', e);
	}
}
