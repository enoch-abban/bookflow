import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { ulid } from 'ulid';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { activityLog, people } from '#lib/server/db/schema.ts';
import { parseBody, resolvePerson } from '#lib/server/api-auth.ts';
import { renameUser } from '#lib/server/accounts.ts';
import { parseOr400, updateMeSchema } from '#lib/server/validation.ts';

// PATCH /api/me { displayName } — anyone signed in renames themselves (spec: the only self-edit;
// role and active status cannot be changed here).
export const PATCH: RequestHandler = async ({ request, locals }) => {
	const { personId, personRow } = await resolvePerson(locals);
	const { displayName } = parseOr400(updateMeSchema, await parseBody(request));
	if (displayName === personRow.displayName) return json({ person: personRow });
	const now = new Date().toISOString();
	const person = await db.transaction(async (tx) => {
		const [row] = await tx.update(people).set({ displayName }).where(eq(people.id, personId)).returning();
		await tx.insert(activityLog).values({
			id: ulid(), seriesId: null, actorId: personId, entity: 'person', entityId: personId, action: 'update',
			beforeJson: JSON.stringify({ displayName: personRow.displayName }), afterJson: JSON.stringify({ displayName }), createdAt: now,
		});
		return row;
	});
	if (person.userId) await renameUser(person.userId, displayName);
	return json({ person });
};
