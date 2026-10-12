import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { timingSafeEqual } from 'node:crypto';
import { CRON_SECRET } from '$app/env/private';
import { runDaily } from '#lib/server/notifications.ts';

// GET /api/cron/daily — the morning job (vercel.json: 07:00 UTC, Africa/Accra time): late
// notices, then a retry of emails that failed. Vercel calls it with "Bearer <CRON_SECRET>".
export const GET: RequestHandler = async ({ request }) => {
	if (!CRON_SECRET) throw error(503, 'CRON_SECRET is not set.');
	const given = Buffer.from(request.headers.get('authorization') ?? '');
	const expected = Buffer.from(`Bearer ${CRON_SECRET}`);
	if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw error(401, 'Not authorised');
	return json(await runDaily());
};
