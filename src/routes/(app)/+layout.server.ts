import type { LayoutServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { people, seriesMembers } from '#lib/server/db/schema.ts';
import { and, eq } from 'drizzle-orm';
import { visibleSeries } from '#lib/server/templates.ts';

const LAST_SERIES = 'bookflow_series';

// The nav follows the series in the URL. Pages outside a series (My tasks, People, Templates)
// keep the last series opened, remembered in a cookie, so its links stay one click away.
export const load: LayoutServerLoad = async ({ locals, params, cookies }) => {
	const me = locals.user
		? await db.select({ id: people.id, isAdmin: people.isAdmin }).from(people).where(eq(people.userId, locals.user.id)).then(r => r[0])
		: undefined;
	const seriesList = await visibleSeries(me?.id ?? null, !!me?.isAdmin);

	const wanted = params.series ?? cookies.get(LAST_SERIES);
	const current = seriesList.find((s) => s.id === wanted) ?? seriesList[0] ?? null;
	if (params.series && current?.id === params.series)
		cookies.set(LAST_SERIES, params.series, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });

	const role = me && current
		? await db.select({ role: seriesMembers.role }).from(seriesMembers)
			.where(and(eq(seriesMembers.seriesId, current.id), eq(seriesMembers.personId, me.id)))
			.then(r => r[0]?.role)
		: undefined;

	return {
		user: locals.user ?? null,
		isAdmin: !!me?.isAdmin,
		canManageSeries: !!me?.isAdmin || role === 'coordinator',
		seriesId: current?.id ?? null,
		seriesList,
	};
};
