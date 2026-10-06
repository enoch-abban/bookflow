import { error, json } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { people, seriesMembers } from '#lib/server/db/schema.ts';
import { and, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';

const coordMembers = alias(seriesMembers, 'coord_members');

export type PersonCtx = { personId: string; isAdmin: boolean; role: string };

/** Resolve the current user to their person record (or 401/403). */
export async function resolvePerson(locals: App.Locals): Promise<PersonCtx & { personRow: typeof people.$inferSelect }> {
	if (!locals.user) throw error(401, 'Unauthenticated');

	const row = await db.select().from(people).where(eq(people.userId, locals.user.id)).then(r => r[0] ?? null);
	if (!row) throw error(403, 'No person record for this account');

	return { personId: row.id, isAdmin: !!row.isAdmin, role: row.isAdmin ? 'admin' : 'contributor', personRow: row };
}

/** Require admin or series coordinator. Returns personId. */
export async function requireCoord(locals: App.Locals, seriesId: string): Promise<PersonCtx> {
	const { personId, personRow } = await resolvePerson(locals);
	if (personRow.isAdmin) return { personId, isAdmin: true, role: 'admin' };

	const mem = await db.select()
		.from(seriesMembers)
		.where(and(eq(seriesMembers.seriesId, seriesId), eq(seriesMembers.personId, personId)))
		.then(r => r[0] ?? null);

	if (!mem || mem.role !== 'coordinator') throw error(403, 'Coordinator role required');
	return { personId, isAdmin: false, role: 'coordinator' };
}

/** Require any series member. Returns personId + role. */
export async function requireMember(locals: App.Locals, seriesId: string): Promise<PersonCtx> {
	const { personId, personRow } = await resolvePerson(locals);
	if (personRow.isAdmin) return { personId, isAdmin: true, role: 'admin' };

	const mem = await db.select()
		.from(seriesMembers)
		.where(and(eq(seriesMembers.seriesId, seriesId), eq(seriesMembers.personId, personId)))
		.then(r => r[0] ?? null);

	if (!mem) throw error(403, 'Not a series member');
	return { personId, isAdmin: false, role: mem.role };
}

/** Require a global admin. */
export async function requireAdmin(locals: App.Locals) {
	const ctx = await resolvePerson(locals);
	if (!ctx.isAdmin) throw error(403, 'Admin role required');
	return ctx;
}

/**
 * Admin, or a coordinator of any series the target person belongs to
 * (spec: coordinators invite their own series' members).
 */
export async function requireCanManagePerson(locals: App.Locals, targetPersonId: string) {
	const ctx = await resolvePerson(locals);
	if (ctx.isAdmin) return ctx;

	const shared = await db
		.select({ seriesId: seriesMembers.seriesId })
		.from(seriesMembers)
		.innerJoin(
			coordMembers,
			and(eq(coordMembers.seriesId, seriesMembers.seriesId), eq(coordMembers.personId, ctx.personId), eq(coordMembers.role, 'coordinator'))
		)
		.where(eq(seriesMembers.personId, targetPersonId))
		.limit(1);
	if (!shared.length) throw error(403, "Admin, or coordinator of this person's series, required");
	return ctx;
}

/** Parse JSON body; throw 400 on failure. */
export async function parseBody<T>(req: Request): Promise<T> {
	try {
		return await req.json() as T;
	} catch {
		throw error(400, 'Invalid JSON body');
	}
}

/** 409 conflict response for stale version. */
export function versionConflict(currentTask: unknown) {
	return json({ error: 'version_conflict', task: currentTask }, { status: 409 });
}

import { tasks, books } from '#lib/server/db/schema.ts';

/** Load task and book together, resolving series. */
export async function loadTaskWithSeries(taskId: string) {
	const row = await db.select({
		task: tasks,
		seriesId: books.seriesId,
	}).from(tasks)
		.innerJoin(books, eq(books.id, tasks.bookId))
		.where(eq(tasks.id, taskId))
		.then(r => r[0] ?? null);

	if (!row) throw error(404, 'Task not found');
	return { task: row.task, seriesId: row.seriesId };
}
