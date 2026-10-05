import type { LayoutServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { series } from '#lib/server/db/schema.ts';
import { asc } from 'drizzle-orm';

export const load: LayoutServerLoad = async ({ locals }) => {
	const allSeries = await db.select({ id: series.id, name: series.name })
		.from(series)
		.orderBy(asc(series.id))
		.limit(1);

	return {
		user: locals.user ?? null,
		seriesId: allSeries[0]?.id ?? null,
	};
};
