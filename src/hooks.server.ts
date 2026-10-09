import type { Handle } from '@sveltejs/kit/hooks';
import { redirect } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { building, dev } from '$app/env';
import { dbStats } from '#lib/server/db/index.ts';
import { currentPerson } from '#lib/server/api-auth.ts';
import { auth } from '#lib/server/auth.ts';
import { svelteKitHandler } from 'better-auth/svelte-kit';

/**
 * Count the database round trips each request makes and how long they take, and report them
 * in a Server-Timing header (visible in the browser's network panel), and in the dev console.
 */
const timeDatabase: Handle = async ({ event, resolve }) => {
	const stats = { trips: 0, ms: 0 };
	const response = await dbStats.run(stats, () => resolve(event));
	const desc = `${stats.trips} database round trip${stats.trips === 1 ? '' : 's'}`;
	try {
		response.headers.append('Server-Timing', `db;desc="${desc}";dur=${stats.ms.toFixed(1)}`);
	} catch {
		/* immutable headers (a redirect); nothing to add */
	}
	if (dev && !event.url.pathname.startsWith('/@') && !event.url.pathname.includes('.'))
		console.info(`[db] ${event.request.method} ${event.url.pathname} ${stats.trips} trips ${stats.ms.toFixed(0)}ms`);
	return response;
};

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	const session = await auth.api.getSession({ headers: event.request.headers });

	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
		// Sessions are cached in a cookie for a few minutes, so a deactivated person's may still
		// look valid: treat them as signed out, which sends pages to the sign-in screen and API
		// calls to 401. The person lookup is shared with the rest of the request.
		const me = await currentPerson(event.locals);
		if (me && !me.active) {
			event.locals.session = undefined;
			event.locals.user = undefined;
		}
	}

	return svelteKitHandler({ event, resolve, auth, building });
};

const PUBLIC_PAGES = ['/login', '/invite/', '/reset-password'];

/** Send signed-out visitors to /login. API routes answer 401 themselves via api-auth. */
const requireSignIn: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;
	const isPublic = PUBLIC_PAGES.some((p) => path === p || path.startsWith(p.endsWith('/') ? p : `${p}/`));

	if (!event.locals.user && !isPublic && !path.startsWith('/api/')) {
		const next = path === '/' ? '' : `?next=${encodeURIComponent(path + event.url.search)}`;
		throw redirect(303, `/login${next}`);
	}
	return resolve(event);
};

export const handle: Handle = sequence(timeDatabase, handleBetterAuth, requireSignIn);
