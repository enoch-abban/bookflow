import type { LayoutServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { currentPerson } from '#lib/server/api-auth.ts';
import { visibleSeries } from '#lib/server/templates.ts';
import { pendingFor } from '#lib/server/admin-transfer.ts';

const LAST_SERIES = 'bookflow_series';

// The nav follows the series in the URL. Pages outside a series (My tasks, People, Templates)
// keep the last series opened, remembered in a cookie, so its links stay one click away.
export const load: LayoutServerLoad = async ({ locals, params, cookies }) => {
	const me = await currentPerson(locals);
	// A deactivated person whose session cookie is still cached is sent back to sign in.
	if (me && !me.active) throw redirect(303, '/login');
	// Admins and managers have app-wide access; only admins manage system roles and holidays.
	const isAdmin = !!me && me.systemRole !== 'member';
	// Their series (with their role on each) and any admin role offered to them, side by side.
	const [seriesList, transfers] = await Promise.all([
		visibleSeries(me?.id ?? null, isAdmin),
		me ? pendingFor(me.id) : Promise.resolve([]),
	]);

	const wanted = params.series ?? cookies.get(LAST_SERIES);
	const current = seriesList.find((s) => s.id === wanted) ?? seriesList[0] ?? null;
	if (params.series && current?.id === params.series)
		cookies.set(LAST_SERIES, params.series, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
	const role = current?.role ?? undefined;

	return {
		user: locals.user ?? null,
		isAdmin,
		systemRole: me?.systemRole ?? 'member',
		me: me ? { id: me.id, displayName: me.displayName } : null,
		canManageSeries: isAdmin || role === 'coordinator',
		seriesId: current?.id ?? null,
		seriesList: seriesList.map(({ id, name, status }) => ({ id, name, status })),
		// For the guided tour: what to show, and whether it still starts by itself.
		role: isAdmin ? me!.systemRole as 'admin' | 'manager' : (role ?? 'contributor') as 'coordinator' | 'contributor' | 'viewer',
		// The tour version this person last finished or skipped; newer steps show as "What's new".
		tourSeen: me?.tourVersion ?? Number.MAX_SAFE_INTEGER,
		// An admin role offered to this person, shown as a banner until they accept or decline.
		incomingTransfer: transfers.find((t) => !t.mine) ?? null,
	};
};
