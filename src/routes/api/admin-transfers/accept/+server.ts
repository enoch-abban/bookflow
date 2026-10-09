import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { parseBody, resolvePerson } from '#lib/server/api-auth.ts';
import { acceptTransfer } from '#lib/server/admin-transfer.ts';

// POST /api/admin-transfers/accept { token } — the named recipient accepts: they become admin
// and the sender takes the role they chose, in one transaction. 410 if expired or voided.
export const POST: RequestHandler = async ({ request, locals }) => {
	const viewer = await resolvePerson(locals);
	const { token } = await parseBody<{ token?: string }>(request);
	if (!token) throw error(400, 'token required');
	return json(await acceptTransfer(viewer, token));
};
