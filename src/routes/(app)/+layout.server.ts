import type { LayoutServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { people, seriesMembers } from '#lib/server/db/schema.ts';
import { and, eq } from 'drizzle-orm';
import { visibleSeries } from '#lib/server/templates.ts';
import { pendingFor } from '#lib/server/admin-transfer.ts';

const LAST_SERIES = 'bookflow_series';

// The nav follows the series in the URL. Pages outside a series (My tasks, People, Templates)
// keep the last series opened, remembered in a cookie, so its links stay one click away.
export const load: LayoutServerLoad = async ({ locals, params, cookies }) => {
	const me = locals.user
		? await db.select({ id: people.id, systemRole: people.systemRole, displayName: people.displayName, tourDoneAt: people.tourDoneAt }).from(people).where(eq(people.userId, locals.user.id)).then(r => r[0])
		: undefined;
	// Admins and managers have app-wide access; only admins manage system roles and holidays.
	const isAdmin = !!me && me.systemRole !== 'member';
	const seriesList = await visibleSeries(me?.id ?? null, isAdmin);

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
		isAdmin,
		systemRole: me?.systemRole ?? 'member',
		me: me ? { id: me.id, displayName: me.displayName } : null,
		canManageSeries: isAdmin || role === 'coordinator',
		seriesId: current?.id ?? null,
		seriesList,
		// For the guided tour: what to show, and whether it still starts by itself.
		role: isAdmin ? me!.systemRole as 'admin' | 'manager' : (role ?? 'contributor') as 'coordinator' | 'contributor' | 'viewer',
		tourDone: !me || !!me.tourDoneAt,
		// An admin role offered to this person, shown as a banner until they accept or decline.
		incomingTransfer: me ? (await pendingFor(me.id)).find((t) => !t.mine) ?? null : null,
	};
};
