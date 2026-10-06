import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { parseBody } from '#lib/server/api-auth.ts';
import { createInvitedAccount } from '#lib/server/accounts.ts';
import { requireOpenInvite } from '#lib/server/invites.ts';
import { acceptSchema, parseOr400 } from '#lib/server/validation.ts';

// POST /api/invites/accept — create the account and email a verification code.
// The person is linked once the code is verified (the /invite/[token] page does both steps).
export const POST: RequestHandler = async ({ request }) => {
	const body = parseOr400(acceptSchema, await parseBody(request));
	const { invite } = await requireOpenInvite(body.token);
	await createInvitedAccount(invite.email, body.displayName, body.password);
	return json({ email: invite.email, verification: 'sent' }, { status: 201 });
};
