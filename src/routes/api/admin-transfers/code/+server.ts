import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { resolvePerson } from '#lib/server/api-auth.ts';
import { sendTransferCode } from '#lib/server/admin-transfer.ts';

// POST /api/admin-transfers/code — email the signed-in admin a fresh code for starting a transfer.
export const POST: RequestHandler = async ({ locals }) => {
	await sendTransferCode(await resolvePerson(locals));
	return json({ sent: true });
};
