import type { LayoutServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { people, series, seriesMembers } from '#lib/server/db/schema.ts';
import { and, asc, eq } from 'drizzle-orm';

export const load: LayoutServerLoad = async ({ locals }) => {
	const allSeries = await db.select({ id: series.id, name: series.name })
		.from(series)
		.orderBy(asc(series.id))
		.limit(1);
	const seriesId = allSeries[0]?.id ?? null;

	const me = locals.user
		? await db.select({ id: people.id, isAdmin: people.isAdmin }).from(people).where(eq(people.userId, locals.user.id)).then(r => r[0])
		: undefined;

	const role = me && seriesId
		? await db.select({ role: seriesMembers.role }).from(seriesMembers)
			.where(and(eq(seriesMembers.seriesId, seriesId), eq(seriesMembers.personId, me.id)))
			.then(r => r[0]?.role)
		: undefined;

	return {
		user: locals.user ?? null,
		isAdmin: !!me?.isAdmin,
		canManageSeries: !!me?.isAdmin || role === 'coordinator',
		seriesId,
	};
};
