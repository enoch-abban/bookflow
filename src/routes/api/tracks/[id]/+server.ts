import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { ulid } from 'ulid';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { activityLog, tracks } from '#lib/server/db/schema.ts';
import { parseBody, requireCoord } from '#lib/server/api-auth.ts';
import { parseOr400, updateTrackSchema } from '#lib/server/validation.ts';

// PATCH /api/tracks/:id — rename a track.
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const before = await db.select().from(tracks).where(eq(tracks.id, params.id)).then((r) => r[0]);
	if (!before) throw error(404, 'Track not found');
	const { personId } = await requireCoord(locals, before.seriesId);
	const { name } = parseOr400(updateTrackSchema, await parseBody(request));
	if (name === before.name) return json({ track: before });

	const track = await db.transaction(async (tx) => {
		const [row] = await tx.update(tracks).set({ name }).where(eq(tracks.id, before.id)).returning();
		await tx.insert(activityLog).values({
			id: ulid(), seriesId: before.seriesId, actorId: personId, entity: 'track', entityId: before.id, action: 'update',
			beforeJson: JSON.stringify({ name: before.name }), afterJson: JSON.stringify({ name }), createdAt: new Date().toISOString(),
		});
		return row;
	});
	return json({ track });
};
