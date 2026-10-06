import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { people } from '#lib/server/db/schema.ts';
import { parseBody, requireCanManagePerson } from '#lib/server/api-auth.ts';
import { issueInvite } from '#lib/server/invites.ts';
import { inviteSchema, parseOr400 } from '#lib/server/validation.ts';

// POST /api/people/:id/invite — send (or resend) an invite; earlier open invites are voided.
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { personRow: inviter } = await requireCanManagePerson(locals, params.id);
	const { email } = parseOr400(inviteSchema, await parseBody(request));

	const person = await db.select().from(people).where(eq(people.id, params.id)).then((r) => r[0]);
	if (!person) throw error(404, 'Person not found');

	const invite = await issueInvite({ person, email, inviter });
	return json({ invite }, { status: 201 });
};
