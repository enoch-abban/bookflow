import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { parseBody, requireAdmin } from '#lib/server/api-auth.ts';
import { createSeriesSchema, parseOr400 } from '#lib/server/validation.ts';
import { createSeries } from '#lib/server/templates.ts';

// POST /api/series — a new series from a template (or a blank pipeline). Admin only.
export const POST: RequestHandler = async ({ request, locals }) => {
	const { personId } = await requireAdmin(locals);
	const input = parseOr400(createSeriesSchema, await parseBody(request));
	return json(await createSeries(input, personId), { status: 201 });
};
