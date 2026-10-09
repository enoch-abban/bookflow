import { redirect } from '@sveltejs/kit';
import { currentPerson } from '#lib/server/api-auth.ts';
import { visibleSeries } from '#lib/server/templates.ts';
import type { PageServerLoad } from './$types';

// Home: straight to the last series opened (or the first one this person can see). With no
// series yet, admins go to "Create your first series"; others are told they are not in one.
export const load: PageServerLoad = async ({ locals, cookies }) => {
	if (!locals.user) throw redirect(303, '/login');
	const me = await currentPerson(locals);
	const list = await visibleSeries(me?.id ?? null, !!me && me.systemRole !== 'member');
	const last = cookies.get('bookflow_series');
	const target = list.find((s) => s.id === last) ?? list[0];
	if (target) throw redirect(303, `/s/${target.id}`);
	if (me && me.systemRole !== 'member') throw redirect(303, '/series/new');
	return { name: locals.user.name };
};
