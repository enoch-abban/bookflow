import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { ulid } from 'ulid';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { activityLog, people } from '#lib/server/db/schema.ts';
import { parseBody, resolvePerson } from '#lib/server/api-auth.ts';
import { renameUser } from '#lib/server/accounts.ts';
import { parseOr400, updateMeSchema } from '#lib/server/validation.ts';
import { setEmailNotifications } from '#lib/server/notifications.ts';

// PATCH /api/me { displayName?, emailNotifications? } — anyone signed in renames themselves, or
// turns task emails on or off (spec: the only self-edits; role and active status cannot be
// changed here).
export const PATCH: RequestHandler = async ({ request, locals }) => {
	const { personId, personRow } = await resolvePerson(locals);
	const { displayName, emailNotifications } = parseOr400(updateMeSchema, await parseBody(request));
	if (emailNotifications !== undefined) {
		await setEmailNotifications(personId, emailNotifications);
		if (displayName === undefined) return json({ person: { ...personRow, emailNotifications: emailNotifications ? 1 : 0 } });
	}
	if (displayName === undefined || displayName === personRow.displayName) return json({ person: personRow });
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
