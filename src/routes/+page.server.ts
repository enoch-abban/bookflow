import { redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { people } from '#lib/server/db/schema.ts';
import { visibleSeries } from '#lib/server/templates.ts';
import type { PageServerLoad } from './$types';

// Home: straight to the last series opened (or the first one this person can see). With no
// series yet, admins go to "Create your first series"; others are told they are not in one.
export const load: PageServerLoad = async ({ locals, cookies }) => {
	if (!locals.user) throw redirect(303, '/login');
	const me = await db.select({ id: people.id, isAdmin: people.isAdmin }).from(people).where(eq(people.userId, locals.user.id)).then((r) => r[0]);
	const list = await visibleSeries(me?.id ?? null, !!me?.isAdmin);
	const last = cookies.get('bookflow_series');
	const target = list.find((s) => s.id === last) ?? list[0];
	if (target) throw redirect(303, `/s/${target.id}`);
	if (me?.isAdmin) throw redirect(303, '/series/new');
	return { name: locals.user.name };
};
