import type { RequestHandler } from './$types';
import { requireMember } from '#lib/server/api-auth.ts';
import { exportTasks } from '#lib/server/export-tasks.ts';

// GET /api/series/:id/export/tasks?group=&batch=&person=&status= — the series' tasks as a CSV
// download, filtered as on the matrix. Anyone who can see the series can export it.
export const GET: RequestHandler = async ({ params, locals, url }) => {
	await requireMember(locals, params.id);
	const q = (k: string) => url.searchParams.get(k) || undefined;
	const { filename, csv } = await exportTasks(params.id, { group: q('group'), batch: q('batch'), person: q('person'), status: q('status') });
	// The byte order mark makes Excel read the file as UTF-8, so names with accents survive.
	return new Response('﻿' + csv, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="${filename}"`,
			'Cache-Control': 'no-store'
		}
	});
};
