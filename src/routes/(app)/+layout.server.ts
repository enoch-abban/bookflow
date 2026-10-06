import type { LayoutServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { people, series } from '#lib/server/db/schema.ts';
import { asc, eq } from 'drizzle-orm';

export const load: LayoutServerLoad = async ({ locals }) => {
	const allSeries = await db.select({ id: series.id, name: series.name })
		.from(series)
		.orderBy(asc(series.id))
		.limit(1);

	const me = locals.user
		? await db.select({ isAdmin: people.isAdmin }).from(people).where(eq(people.userId, locals.user.id)).then(r => r[0])
		: undefined;

	return {
		user: locals.user ?? null,
		isAdmin: !!me?.isAdmin,
		seriesId: allSeries[0]?.id ?? null,
	};
};
