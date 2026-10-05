import { redirect } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { series } from '#lib/server/db/schema.ts';
import { asc } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [first] = await db.select({ id: series.id }).from(series).orderBy(asc(series.id)).limit(1);
	if (first) throw redirect(303, `/s/${first.id}`);
};
