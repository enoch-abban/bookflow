import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { people } from '#lib/server/db/schema.ts';
import { parseBody, resolvePerson } from '#lib/server/api-auth.ts';
import { TOUR_VERSION } from '#lib/tour/steps.ts';

// POST /api/me/tour { done } — remember that the signed-in person finished or skipped the
// current tour, so neither it nor its "What's new" run starts again (on any device).
// { done: false } forgets, so it starts from the beginning next time.
export const POST: RequestHandler = async ({ request, locals }) => {
	const { personId } = await resolvePerson(locals);
	const { done } = await parseBody<{ done?: boolean }>(request);
	const tourVersion = done === false ? 0 : TOUR_VERSION;
	await db.update(people).set({ tourVersion }).where(eq(people.id, personId));
	return json({ tourVersion });
};
