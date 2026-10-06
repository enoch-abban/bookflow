import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { invites } from '#lib/server/db/schema.ts';
import { resolvePerson } from '#lib/server/api-auth.ts';
import { publicInvite, revokeInvite } from '#lib/server/invites.ts';

// DELETE /api/invites/:id — revoke an unused invite. Admin or the inviter.
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const actor = await resolvePerson(locals);
	const invite = await db.select().from(invites).where(eq(invites.id, params.id)).then((r) => r[0]);
	if (!invite) throw error(404, 'Invite not found');
	if (!actor.isAdmin && invite.invitedBy !== actor.personId) throw error(403, 'Only an admin or the inviter can revoke this invite');

	await revokeInvite(invite, actor.personRow);
	return json({ invite: { ...publicInvite(invite), state: 'revoked' } });
};
