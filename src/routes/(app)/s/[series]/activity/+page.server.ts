import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { series } from '#lib/server/db/schema.ts';
import { requireCoord } from '#lib/server/api-auth.ts';
import { actorsOf, feed, UNDO_LIMIT } from '#lib/server/history.ts';

// Activity log (spec: Activity log): every change on the series, newest first, one item per
// batch. Each person can undo their own last 50 changes here, and an admin any change.
export const load: PageServerLoad = async ({ params, url, locals }) => {
	const me = await requireCoord(locals, params.series);
	const ser = await db.select({ id: series.id, name: series.name }).from(series).where(eq(series.id, params.series)).then((r) => r[0]);
	if (!ser) throw error(404, 'Series not found');

	const who = url.searchParams.get('who') ?? '';
	const actorId = who === 'me' ? me.personId : who || undefined;
	const before = url.searchParams.get('before') ?? undefined;
	const { items, cursor } = await feed({ seriesId: ser.id, viewer: { personId: me.personId, isAdmin: me.isAdmin }, actorId, before });

	return {
		series: ser, items, cursor, who, before: before ?? null,
		actors: await actorsOf(ser.id), me: { personId: me.personId, isAdmin: me.isAdmin }, limit: UNDO_LIMIT,
	};
};
