import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { ulid } from 'ulid';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { activityLog, people } from '#lib/server/db/schema.ts';
import { parseBody, requireAdmin } from '#lib/server/api-auth.ts';
import { endSessions, renameUser } from '#lib/server/accounts.ts';
import { parseOr400, updatePersonSchema } from '#lib/server/validation.ts';
import { checkPersonChange, notifyRoleChange } from '#lib/server/system-roles.ts';
import { voidStaleTransfers } from '#lib/server/admin-transfer.ts';

// PATCH /api/people/:id { displayName?, active?, systemRole? } — rename, deactivate, reactivate,
// or change someone's app-wide role. Admins and managers may call it; checkPersonChange holds
// who may change whom (spec: Users, roles and permissions). Deactivation ends their sessions; a
// role change applies on their next request and is emailed to them.
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const actor = await requireAdmin(locals);
	const body = parseOr400(updatePersonSchema, await parseBody(request));

	const before = await db.select().from(people).where(eq(people.id, params.id)).then((r) => r[0]);
	if (!before) throw error(404, 'Person not found');
	await checkPersonChange(actor, before, body);

	const patch: Partial<typeof people.$inferInsert> = {};
	if (body.displayName !== undefined) patch.displayName = body.displayName;
	if (body.active !== undefined) patch.active = body.active ? 1 : 0;
	if (body.systemRole !== undefined) patch.systemRole = body.systemRole;
	const roleChanged = body.systemRole !== undefined && body.systemRole !== before.systemRole;

	const now = new Date().toISOString();
	const person = await db.transaction(async (tx) => {
		const [row] = await tx.update(people).set(patch).where(eq(people.id, before.id)).returning();
		await tx.insert(activityLog).values({
			id: ulid(), seriesId: null, actorId: actor.personId,
			entity: 'person', entityId: before.id,
			action: roleChanged ? 'role' : body.active === undefined ? 'update' : body.active ? 'reactivate' : 'deactivate',
			beforeJson: JSON.stringify(before), afterJson: JSON.stringify(row), createdAt: now,
		});
		return row;
	});

	if (person.userId) {
		if (body.displayName !== undefined) await renameUser(person.userId, body.displayName);
		if (body.active === false) await endSessions(person.userId);
	}
	// A deactivation or role change can void a pending admin transfer (spec: Voided).
	if (roleChanged || body.active === false) await voidStaleTransfers();
	if (roleChanged) await notifyRoleChange(person, before.systemRole, person.systemRole, actor.personRow.displayName);
	return json({ person });
};
