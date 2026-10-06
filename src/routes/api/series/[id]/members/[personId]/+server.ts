import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { ulid } from 'ulid';
import { and, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { activityLog, people, series, seriesMembers } from '#lib/server/db/schema.ts';
import { parseBody, requireCoord } from '#lib/server/api-auth.ts';
import { memberSchema, parseOr400 } from '#lib/server/validation.ts';

// PUT /api/series/:id/members/:personId — add a person to the series or update their membership.
// Granting, changing or removing the coordinator role is admin-only.
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const actor = await requireCoord(locals, params.id);
	const body = parseOr400(memberSchema, await parseBody(request));

	const ser = await db.select({ id: series.id }).from(series).where(eq(series.id, params.id)).then((r) => r[0]);
	if (!ser) throw error(404, 'Series not found');
	const person = await db.select().from(people).where(eq(people.id, params.personId)).then((r) => r[0]);
	if (!person) throw error(404, 'Person not found');
	if (!person.active) throw error(409, 'This person is deactivated.');

	const key = and(eq(seriesMembers.seriesId, ser.id), eq(seriesMembers.personId, person.id));
	const before = await db.select().from(seriesMembers).where(key).then((r) => r[0] ?? null);

	const touchesCoordinator = body.role === 'coordinator' ? before?.role !== 'coordinator' : before?.role === 'coordinator';
	if (touchesCoordinator && !actor.isAdmin) throw error(403, 'Only an admin can grant or remove the coordinator role.');

	const member = { seriesId: ser.id, personId: person.id, role: body.role, teamLabel: body.teamLabel, capacity: body.capacity };

	const saved = await db.transaction(async (tx) => {
		const [row] = before
			? await tx.update(seriesMembers).set({ role: body.role, teamLabel: body.teamLabel, capacity: body.capacity }).where(key).returning()
			: await tx.insert(seriesMembers).values(member).returning();
		await tx.insert(activityLog).values({
			id: ulid(), seriesId: ser.id, actorId: actor.personId,
			entity: 'member', entityId: person.id, action: before ? 'update' : 'create',
			beforeJson: before ? JSON.stringify(before) : null,
			afterJson: JSON.stringify(row),
			createdAt: new Date().toISOString(),
		});
		return row;
	});

	return json({ member: saved }, { status: before ? 200 : 201 });
};
