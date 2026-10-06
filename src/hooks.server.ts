import type { Handle } from '@sveltejs/kit/hooks';
import { redirect } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import { auth } from '#lib/server/auth.ts';
import { svelteKitHandler } from 'better-auth/svelte-kit';

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	const session = await auth.api.getSession({ headers: event.request.headers });

	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
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

export const handle: Handle = sequence(handleBetterAuth, requireSignIn);
