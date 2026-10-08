import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { people } from '#lib/server/db/schema.ts';
import { parseBody, resolvePerson } from '#lib/server/api-auth.ts';

// POST /api/me/tour { done } — remember that the signed-in person finished or skipped the
// guided tour, so it does not start again on their next visit (on any device).
export const POST: RequestHandler = async ({ request, locals }) => {
	const { personId } = await resolvePerson(locals);
	const { done } = await parseBody<{ done?: boolean }>(request);
	const tourDoneAt = done === false ? null : new Date().toISOString();
	await db.update(people).set({ tourDoneAt }).where(eq(people.id, personId));
	return json({ tourDoneAt });
};
