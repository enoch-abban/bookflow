import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { resolvePerson } from '#lib/server/api-auth.ts';
import { cancelTransfer } from '#lib/server/admin-transfer.ts';

// DELETE /api/admin-transfers/:id — the sender cancels, or the recipient declines.
export const DELETE: RequestHandler = async ({ params, locals }) => json(await cancelTransfer(await resolvePerson(locals), params.id));
