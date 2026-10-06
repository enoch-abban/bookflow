import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { ulid } from 'ulid';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { activityLog, people } from '#lib/server/db/schema.ts';
import { parseBody, requireAdmin } from '#lib/server/api-auth.ts';
import { endSessions, renameUser } from '#lib/server/accounts.ts';
import { parseOr400, updatePersonSchema } from '#lib/server/validation.ts';

// PATCH /api/people/:id — rename, deactivate or reactivate. Deactivation ends their sessions.
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const actor = await requireAdmin(locals);
	const body = parseOr400(updatePersonSchema, await parseBody(request));

	const before = await db.select().from(people).where(eq(people.id, params.id)).then((r) => r[0]);
	if (!before) throw error(404, 'Person not found');
	if (body.active === false && before.id === actor.personId) throw error(409, 'You cannot deactivate yourself.');

	const patch: Partial<typeof people.$inferInsert> = {};
	if (body.displayName !== undefined) patch.displayName = body.displayName;
	if (body.active !== undefined) patch.active = body.active ? 1 : 0;

	const now = new Date().toISOString();
	const person = await db.transaction(async (tx) => {
		const [row] = await tx.update(people).set(patch).where(eq(people.id, before.id)).returning();
		await tx.insert(activityLog).values({
			id: ulid(), seriesId: null, actorId: actor.personId,
			entity: 'person', entityId: before.id,
			action: body.active === undefined ? 'update' : body.active ? 'reactivate' : 'deactivate',
			beforeJson: JSON.stringify(before), afterJson: JSON.stringify(row), createdAt: now,
		});
		return row;
	});

	if (person.userId) {
		if (body.displayName !== undefined) await renameUser(person.userId, body.displayName);
		if (body.active === false) await endSessions(person.userId);
	}
	return json({ person });
};
