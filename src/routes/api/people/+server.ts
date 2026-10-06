import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { ulid } from 'ulid';
import { sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { activityLog, people, seriesMembers } from '#lib/server/db/schema.ts';
import { parseBody, requireCoord, resolvePerson } from '#lib/server/api-auth.ts';
import { createPersonSchema, parseOr400 } from '#lib/server/validation.ts';

// POST /api/people — create a placeholder person.
// Coordinators must name their series; the person is added to it.
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = parseOr400(createPersonSchema, await parseBody(request));
	const actor = await resolvePerson(locals);

	if (!actor.isAdmin) {
		if (!body.seriesId) throw error(403, 'Coordinators must add people to one of their series');
		await requireCoord(locals, body.seriesId);
		if (body.role === 'coordinator') throw error(403, 'Only an admin can add a coordinator');
	}

	if (body.email) {
		const clash = await db.select({ id: people.id }).from(people).where(sql`lower(${people.email}) = ${body.email}`);
		if (clash.length) throw error(409, 'Another person already uses this email.');
	}

	const id = ulid();
	const now = new Date().toISOString();
	const person = await db.transaction(async (tx) => {
		const [row] = await tx
			.insert(people)
			.values({ id, displayName: body.displayName, email: body.email ?? null })
			.returning();

		await tx.insert(activityLog).values({
			id: ulid(), seriesId: null, actorId: actor.personId,
			entity: 'person', entityId: id, action: 'create',
			afterJson: JSON.stringify(row), createdAt: now,
		});

		if (body.seriesId) {
			const member = { seriesId: body.seriesId, personId: id, role: body.role, teamLabel: body.teamLabel ?? null };
			await tx.insert(seriesMembers).values(member);
			await tx.insert(activityLog).values({
				id: ulid(), seriesId: body.seriesId, actorId: actor.personId,
				entity: 'member', entityId: id, action: 'create',
				afterJson: JSON.stringify(member), createdAt: now,
			});
		}
		return row;
	});

	return json({ person }, { status: 201 });
};
