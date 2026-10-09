import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { parseBody, resolvePerson } from '#lib/server/api-auth.ts';
import { parseOr400, startTransferSchema } from '#lib/server/validation.ts';
import { startTransfer } from '#lib/server/admin-transfer.ts';

// POST /api/admin-transfers { toPersonId, senderNewRole, password, code } — start a transfer of
// the admin role; the recipient is emailed a link. 409 if one is already pending or the
// recipient has no account.
export const POST: RequestHandler = async ({ request, locals }) => {
	const actor = await resolvePerson(locals);
	const input = parseOr400(startTransferSchema, await parseBody(request));
	return json(await startTransfer(actor, input), { status: 201 });
};
