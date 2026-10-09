import { error, json } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { people, seriesMembers } from '#lib/server/db/schema.ts';
import { and, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';

const coordMembers = alias(seriesMembers, 'coord_members');

import type { SystemRole } from '#lib/roles.ts';
export type { SystemRole };

/**
 * isAdmin means app-wide access: admins and managers. Wherever the spec lists Admin, managers
 * may act too (spec: Users, roles and permissions); the few admin-only actions (system roles,
 * holidays, other admins' and managers' accounts) check systemRole instead.
 */
export type PersonCtx = { personId: string; isAdmin: boolean; systemRole: SystemRole; role: string };

// The signed-in person, looked up once per request however many checks ask for it.
const personCache = new WeakMap<App.Locals, Promise<typeof people.$inferSelect | null>>();

/** The signed-in person's record, or null; one database round trip per request at most. */
export function currentPerson(locals: App.Locals): Promise<typeof people.$inferSelect | null> {
	if (!locals.user) return Promise.resolve(null);
	let found = personCache.get(locals);
	if (!found) {
		const userId = locals.user.id;
		found = db.select().from(people).where(eq(people.userId, userId)).then(r => r[0] ?? null);
		personCache.set(locals, found);
	}
	return found;
}

/**
 * Resolve the current user to their person record (or 401/403). Read on every request, so a role
 * change takes effect at once, and a deactivated person is refused even while their session
 * cookie is still cached.
 */
export async function resolvePerson(locals: App.Locals): Promise<PersonCtx & { personRow: typeof people.$inferSelect }> {
	if (!locals.user) throw error(401, 'Unauthenticated');

	const row = await currentPerson(locals);
	if (!row) throw error(403, 'No person record for this account');
	if (!row.active) throw error(403, 'This account has been deactivated.');

	const systemRole = row.systemRole;
	const isAdmin = systemRole !== 'member';
	return { personId: row.id, isAdmin, systemRole, role: isAdmin ? systemRole : 'contributor', personRow: row };
}

// Series memberships looked up once per request and series.
const memberCache = new WeakMap<App.Locals, Map<string, Promise<typeof seriesMembers.$inferSelect | null>>>();
function membership(locals: App.Locals, seriesId: string, personId: string) {
	let bySeries = memberCache.get(locals);
	if (!bySeries) memberCache.set(locals, (bySeries = new Map()));
	let found = bySeries.get(seriesId);
	if (!found) {
		found = db.select().from(seriesMembers)
			.where(and(eq(seriesMembers.seriesId, seriesId), eq(seriesMembers.personId, personId)))
			.then(r => r[0] ?? null);
		bySeries.set(seriesId, found);
	}
	return found;
}

/** Require admin, manager (coordinator on every series) or series coordinator. */
export async function requireCoord(locals: App.Locals, seriesId: string): Promise<PersonCtx> {
	const { personId, isAdmin, systemRole } = await resolvePerson(locals);
	if (isAdmin) return { personId, isAdmin, systemRole, role: systemRole };

	const mem = await membership(locals, seriesId, personId);

	if (!mem || mem.role !== 'coordinator') throw error(403, 'Only a coordinator on this series can do that.');
	return { personId, isAdmin: false, systemRole, role: 'coordinator' };
}

/** Require any series member (admins and managers count as members of every series). */
export async function requireMember(locals: App.Locals, seriesId: string): Promise<PersonCtx> {
	const { personId, isAdmin, systemRole } = await resolvePerson(locals);
	if (isAdmin) return { personId, isAdmin, systemRole, role: systemRole };

	const mem = await membership(locals, seriesId, personId);

	if (!mem) throw error(403, 'Not a series member');
	return { personId, isAdmin: false, systemRole, role: mem.role };
}

/** Require app-wide access: an admin or a manager. */
export async function requireAdmin(locals: App.Locals) {
	const ctx = await resolvePerson(locals);
	if (!ctx.isAdmin) throw error(403, 'Only an admin or manager can do that.');
	return ctx;
}

/** Require an admin: system roles, holidays, and other admins' and managers' accounts. */
export async function requireSystemAdmin(locals: App.Locals) {
	const ctx = await resolvePerson(locals);
	if (ctx.systemRole !== 'admin') throw error(403, 'Only an admin can do that.');
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
