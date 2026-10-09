import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { ulid } from 'ulid';
import { db } from '#lib/server/db/index.ts';
import { tasks, taskAssignees, dependencies, activityLog, people, seriesMembers } from '#lib/server/db/schema.ts';
import { eq, and } from 'drizzle-orm';
import { parseBody, versionConflict, loadTaskWithSeries, resolvePerson } from '#lib/server/api-auth.ts';
import { isAllowedTransition } from '#lib/server/scheduler.ts';
import { statusGuard, statusUpdates } from '#lib/server/task-status.ts';
import { loadSeriesContext } from '#lib/server/series-context.ts';
import { refit } from '#lib/server/refit.ts';
import { refitChanges, refitReport, writeTaskChanges } from '#lib/server/schedule-write.ts';
import { taskDetail } from '#lib/server/task-detail.ts';

// ── PATCH /api/tasks/:id ─────────────────────────────────────────────────────
// GET /api/tasks/:id — everything the task drawer shows, for any series member.
export const GET: RequestHandler = async ({ params, locals }) => json(await taskDetail(locals, params.id));

// Body: any of { title, notes, status, blockedReason, feedbackUrl, overflowAllowed, version, preview }
// Coordinator can change anything; assignees can change status, notes, feedbackUrl.
// Turning overflowAllowed off refits the schedule; with preview the impact is returned unsaved.

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const { id } = params;
	const body = await parseBody<{
		title?: string;
		notes?: string;
		status?: string;
		blockedReason?: string;
		feedbackUrl?: string;
		overflowAllowed?: boolean;
		preview?: boolean;
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
	if (!isCoord && body.overflowAllowed !== undefined) throw error(403, 'Coordinator role required to change overflow');

	// Assignees can change status, notes, feedbackUrl
	if (!isAssignee) throw error(403, 'Must be an assignee or coordinator');

	// Validate status transition
	const updates: Record<string, unknown> = {};
	if (body.title        !== undefined) updates.title        = body.title;
	if (body.notes        !== undefined) updates.notes        = body.notes;
	if (body.feedbackUrl  !== undefined) updates.feedbackUrl  = body.feedbackUrl;
	if (body.blockedReason !== undefined) updates.blockedReason = body.blockedReason;
	if (body.overflowAllowed !== undefined && body.overflowAllowed !== !!task.overflowAllowed)
		updates.overflowAllowed = body.overflowAllowed ? 1 : 0;

	if (body.status !== undefined && body.status !== task.status) {
		if (!isAllowedTransition(task.status, body.status)) {
			throw error(422, `Transition ${task.status} → ${body.status} not allowed`);
		}
		// Gates complete only through approval; ISBN issued needs an ISBN (shared with My tasks).
		await statusGuard(task, body.status);
		Object.assign(updates, statusUpdates(task, body.status, new Date().toISOString()));
	}

	// Switching overflow off may leave the task past its allowance: refit (spec: Changing windows).
	const ctx = updates.overflowAllowed === 0 ? await loadSeriesContext(seriesId) : null;
	const original = ctx ? new Map([...ctx.taskMap].map(([k, v]) => [k, { ...v }])) : null;
	if (ctx) ctx.taskMap.set(id, { ...ctx.taskMap.get(id)!, overflowAllowed: false });
	const result = ctx ? refit(ctx.taskMap, ctx.depList, ctx.rules) : null;
	const report = ctx && result ? refitReport(ctx, original!, result) : null;
	if (body.preview) return json({ preview: true, report });

	if (Object.keys(updates).length === 0) {
		// Nothing to change (same status, no other fields)
		return json({ task });
	}

	const now = new Date().toISOString();
	updates.version   = task.version + 1;
	updates.updatedAt = now;

	const batchId = ulid();
	await db.transaction(async tx => {
		await tx.update(tasks).set(updates).where(eq(tasks.id, id));
		await tx.insert(activityLog).values({
			id:         ulid(),
			seriesId,
			actorId:    personId,
			entity:     'task',
			entityId:   id,
			action:     body.status !== undefined ? 'status' : 'update',
			beforeJson: JSON.stringify({ status: task.status, overflowAllowed: task.overflowAllowed, version: task.version }),
			afterJson:  JSON.stringify({ ...updates }),
			batchId,
			createdAt:  now,
		});

		if (result?.changes.length) {
			// This task's version was just bumped above.
			original!.set(id, { ...original!.get(id)!, version: task.version + 1 });
			await writeTaskChanges(tx, { seriesId, actorId: personId, batchId, now, original: original!, changes: refitChanges(result) });
		}
	});

	// Re-fetch updated task
	const updated = await db.select().from(tasks).where(eq(tasks.id, id)).then(r => r[0]);
	return json({ task: updated, report, batchId });
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

	const isAdmin = await db.select({ systemRole: people.systemRole })
		.from(people).where(eq(people.id, personId))
		.then(r => !!r[0] && r[0].systemRole !== 'member');

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
