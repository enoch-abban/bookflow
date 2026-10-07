import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { ulid } from 'ulid';
import { db } from '#lib/server/db/index.ts';
import { tasks, taskAssignees, activityLog, books, series, stages, windows } from '#lib/server/db/schema.ts';
import { asc, eq } from 'drizzle-orm';
import { requireCoord, parseBody } from '#lib/server/api-auth.ts';
import { checkExplicitMove, deriveEnd } from '#lib/server/scheduler.ts';
import { refreshHolidays } from '#lib/server/calendar-db.ts';

type Body = {
	bookId:       string;
	stageId:      string;
	windowId?:    string | null;
	start:        string;
	durationDays: number;
	personIds?:   string[];
	leadId?:      string;
};

// POST /api/tasks
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await parseBody<Body>(request);
	if (!body.bookId || !body.stageId || !body.start) throw error(400, 'bookId, stageId and start are required');

	// Resolve series
	const book = await db.select({ seriesId: books.seriesId }).from(books).where(eq(books.id, body.bookId)).then(r => r[0]);
	if (!book) throw error(404, 'Book not found');

	const stage = await db.select({ name: stages.name, ignoresWindows: stages.ignoresWindows }).from(stages).where(eq(stages.id, body.stageId)).then(r => r[0]);
	if (!stage) throw error(404, 'Stage not found');

	const { personId } = await requireCoord(locals, book.seriesId);

	await refreshHolidays();
	const taskId  = ulid();
	const now     = new Date().toISOString();
	const newEnd  = deriveEnd(body.start, body.durationDays);
	const title   = stage.name;

	// A new task must fit the window it starts in, like any move (the client's windowId is not trusted).
	const ser = await db.select().from(series).where(eq(series.id, book.seriesId)).then(r => r[0]);
	const wins = await db.select().from(windows).where(eq(windows.seriesId, book.seriesId)).orderBy(asc(windows.startDate));
	const check = checkExplicitMove(
		{ id: taskId, startDate: body.start, endDate: newEnd, durationDays: body.durationDays, status: 'not_started', windowId: null, ignoresWindows: !!stage.ignoresWindows, version: 1 },
		{ enforce: !!ser.enforceWindows, windows: wins, overflowDays: ser.windowOverflowDays }
	);
	if (!check.ok) return json({ error: 'window_violation', message: `This task ${check.reason}.` }, { status: 422 });

	await db.transaction(async tx => {
		await tx.insert(tasks).values({
			id:           taskId,
			bookId:       body.bookId,
			stageId:      body.stageId,
			windowId:     check.windowId,
			title,
			startDate:    body.start,
			endDate:      newEnd,
			durationDays: body.durationDays,
			status:       'not_started',
			iteration:    1,
			version:      1,
			createdAt:    now,
			updatedAt:    now,
		});

		if (body.personIds?.length) {
			for (const pid of body.personIds) {
				await tx.insert(taskAssignees).values({
					taskId,
					personId: pid,
					isLead:   pid === body.leadId ? 1 : 0,
				});
			}
		}

		await tx.insert(activityLog).values({
			id:        ulid(),
			seriesId:  book.seriesId,
			actorId:   personId,
			entity:    'task',
			entityId:  taskId,
			action:    'create',
			afterJson: JSON.stringify({ bookId: body.bookId, stageId: body.stageId, startDate: body.start, endDate: newEnd }),
			createdAt: now,
		});
	});

	const created = await db.select().from(tasks).where(eq(tasks.id, taskId)).then(r => r[0]);
	return json({ task: created }, { status: 201 });
};
