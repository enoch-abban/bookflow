import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { ulid } from 'ulid';
import { db } from '#lib/server/db/index.ts';
import { tasks, taskAssignees, dependencies, activityLog, people, seriesMembers } from '#lib/server/db/schema.ts';
import { eq, and, inArray } from 'drizzle-orm';
import { parseBody, versionConflict, loadTaskWithSeries, resolvePerson } from '#lib/server/api-auth.ts';
import { isAllowedTransition } from '#lib/server/scheduler.ts';

// ── PATCH /api/tasks/:id ─────────────────────────────────────────────────────
// Body: any of { title, notes, status, blockedReason, feedbackUrl, version }
// Coordinator can change anything; assignees can change status, notes, feedbackUrl.

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const { id } = params;
	const body = await parseBody<{
		title?: string;
		notes?: string;
		status?: string;
		blockedReason?: string;
		feedbackUrl?: string;
		version: number;
	}>(request);

	const { task, seriesId } = await loadTaskWithSeries(id);
	if (task.version !== body.version) return versionConflict(task);

	// Check permission: coordinator, or assignee for status/notes/feedbackUrl
	const { personId, isAdmin } = await resolvePerson(locals);

	const isCoord = isAdmin || await (async () => {
		const mem = await db.select()
			.from(seriesMembers)
			.where(and(eq(seriesMembers.seriesId, seriesId), eq(seriesMembers.personId, personId)))
			.then(r => r[0] ?? null);
		return mem?.role === 'coordinator';
	})();

	const isAssignee = isCoord || await (async () => {
		const a = await db.select()
			.from(taskAssignees)
			.where(and(eq(taskAssignees.taskId, id), eq(taskAssignees.personId, personId)))
			.then(r => r[0] ?? null);
		return !!a;
	})();

	// Non-coordinator fields are title only
	if (!isCoord && body.title !== undefined) throw error(403, 'Coordinator role required to change title');

	// Assignees can change status, notes, feedbackUrl
	if (!isAssignee) throw error(403, 'Must be an assignee or coordinator');

	// Validate status transition
	const updates: Record<string, unknown> = {};
	if (body.title        !== undefined) updates.title        = body.title;
	if (body.notes        !== undefined) updates.notes        = body.notes;
	if (body.feedbackUrl  !== undefined) updates.feedbackUrl  = body.feedbackUrl;
	if (body.blockedReason !== undefined) updates.blockedReason = body.blockedReason;

	if (body.status !== undefined && body.status !== task.status) {
		if (!isAllowedTransition(task.status, body.status)) {
			throw error(422, `Transition ${task.status} → ${body.status} not allowed`);
		}

		updates.status = body.status;

		if (body.status === 'blocked') {
			updates.statusBeforeBlock = task.status;
		} else if (task.status === 'blocked') {
			// Unblocking: clear the saved state
			updates.statusBeforeBlock = null;
			updates.blockedReason     = null;
		}

		if (body.status === 'done') {
			updates.completedAt = new Date().toISOString();
		}

		if (body.status === 'in_progress' && task.status === 'returned') {
			updates.iteration = (task.iteration ?? 1) + 1;
		}
	}

	if (Object.keys(updates).length === 0) {
		// Nothing to change (same status, no other fields)
		return json({ task });
	}

	const now = new Date().toISOString();
	updates.version   = task.version + 1;
	updates.updatedAt = now;

	await db.transaction(async tx => {
		await tx.update(tasks).set(updates).where(eq(tasks.id, id));
		await tx.insert(activityLog).values({
			id:         ulid(),
			seriesId,
			actorId:    personId,
			entity:     'task',
			entityId:   id,
			action:     body.status !== undefined ? 'status' : 'update',
			beforeJson: JSON.stringify({ status: task.status, version: task.version }),
			afterJson:  JSON.stringify({ ...updates }),
			createdAt:  now,
		});
	});

	// Re-fetch updated task
	const updated = await db.select().from(tasks).where(eq(tasks.id, id)).then(r => r[0]);
	return json({ task: updated });
};

// ── DELETE /api/tasks/:id ────────────────────────────────────────────────────
// Body: { version }
// Relinks predecessor→successor dependencies, then removes the task.

export const DELETE: RequestHandler = async ({ params, request, locals }) => {
	const { id } = params;
	const body = await parseBody<{ version: number }>(request);

	const { task, seriesId } = await loadTaskWithSeries(id);
	if (task.version !== body.version) return versionConflict(task);

	const { personId } = await resolvePerson(locals);

	// Must be coordinator/admin
	const mem = await db.select()
		.from(seriesMembers)
		.where(and(eq(seriesMembers.seriesId, seriesId), eq(seriesMembers.personId, personId)))
		.then(r => r[0] ?? null);

	const isAdmin = await db.select({ isAdmin: people.isAdmin })
		.from(people).where(eq(people.id, personId))
		.then(r => !!r[0]?.isAdmin);

	if (!isAdmin && mem?.role !== 'coordinator') throw error(403, 'Coordinator role required');

	// Find all deps involving this task
	const preds = await db.select().from(dependencies).where(eq(dependencies.successorId, id));
	const succs = await db.select().from(dependencies).where(eq(dependencies.predecessorId, id));

	const now = new Date().toISOString();

	await db.transaction(async tx => {
		// Relink: for each predecessor, create dep to each successor (skip dupes)
		for (const pred of preds) {
			for (const succ of succs) {
				await tx.insert(dependencies).values({
					id:            ulid(),
					predecessorId: pred.predecessorId,
					successorId:   succ.successorId,
					lagDays:       pred.lagDays + succ.lagDays,
				}).onConflictDoNothing();
			}
		}

		// Remove all deps touching this task (cascade handles it, but belt-and-suspenders)
		await tx.delete(dependencies).where(eq(dependencies.successorId, id));
		await tx.delete(dependencies).where(eq(dependencies.predecessorId, id));

		// Remove task (cascades to taskAssignees, reviewCycles, comments)
		await tx.delete(tasks).where(eq(tasks.id, id));

		await tx.insert(activityLog).values({
			id:         ulid(),
			seriesId,
			actorId:    personId,
			entity:     'task',
			entityId:   id,
			action:     'delete',
			beforeJson: JSON.stringify(task),
			createdAt:  now,
		});
	});

	return json({ deleted: id });
};
