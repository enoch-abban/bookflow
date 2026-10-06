import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { ulid } from 'ulid';
import { eq } from 'drizzle-orm';
import { auth } from '#lib/server/auth.ts';
import { db } from '#lib/server/db/index.ts';
import { activityLog, people } from '#lib/server/db/schema.ts';
import { requireAdmin } from '#lib/server/api-auth.ts';
import { emailForUser } from '#lib/server/accounts.ts';

// POST /api/people/:id/password-reset — email that person a reset link.
export const POST: RequestHandler = async ({ params, locals }) => {
	const actor = await requireAdmin(locals);
	const person = await db.select().from(people).where(eq(people.id, params.id)).then((r) => r[0]);
	if (!person) throw error(404, 'Person not found');

	const email = person.userId ? await emailForUser(person.userId) : null;
	if (!email) throw error(409, 'This person has no account yet. Send an invite instead.');

	await auth.api.requestPasswordReset({ body: { email } });
	await db.insert(activityLog).values({
		id: ulid(), seriesId: null, actorId: actor.personId,
		entity: 'person', entityId: person.id, action: 'password_reset',
		createdAt: new Date().toISOString(),
	});
	return json({ sent: true });
};
