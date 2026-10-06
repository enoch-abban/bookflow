import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '#lib/server/auth.ts';
import {
	checkPassword,
	clearPendingLogin,
	getPendingLogin,
	otpErrorMessage,
	setPendingLogin
} from '#lib/server/accounts.ts';

/** Only follow same-site relative paths after sign-in. */
function safeNext(url: URL): string {
	const next = url.searchParams.get('next') ?? '/';
	return next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export const load: PageServerLoad = ({ locals, url, cookies }) => {
	if (locals.user) throw redirect(303, safeNext(url));
	const pendingEmail = getPendingLogin(cookies);
	return {
		pendingEmail,
		notice: url.searchParams.get('reset') ? 'Your password was changed. Sign in with the new one.' : null
	};
};

const PASSWORD_ERRORS = {
	invalid: 'Email or password is incorrect.',
	unverified: 'This account was never confirmed. Open your invite link again to finish setting it up.',
	no_person: 'This account is not linked to anyone in bookflow. Ask an admin for an invite.',
	inactive: 'This account has been deactivated. Contact your admin.'
} as const;

export const actions: Actions = {
	password: async ({ request, cookies }) => {
		const form = await request.formData();
		const email = form.get('email')?.toString().trim() ?? '';
		const password = form.get('password')?.toString() ?? '';
		if (!email || !password) return fail(400, { step: 'password', email, message: 'Enter your email and password.' });

		const result = await checkPassword(email, password);
		if (!result.ok) return fail(400, { step: 'password', email, message: PASSWORD_ERRORS[result.reason] });

		await auth.api.sendVerificationOTP({ body: { email: result.email, type: 'sign-in' } });
		setPendingLogin(cookies, result.email);
		return { step: 'code', email: result.email };
	},

	code: async ({ request, cookies, url }) => {
		const email = getPendingLogin(cookies);
		if (!email) return fail(400, { step: 'password', email: '', message: 'Your sign-in timed out. Enter your password again.' });

		const otp = (await request.formData()).get('code')?.toString().replace(/\s/g, '') ?? '';
		try {
			await auth.api.signInEmailOTP({ body: { email, otp }, headers: request.headers });
		} catch (err) {
			return fail(400, { step: 'code', email, message: otpErrorMessage(err) });
		}
		clearPendingLogin(cookies);
		throw redirect(303, safeNext(url));
	},

	resend: async ({ cookies }) => {
		const email = getPendingLogin(cookies);
		if (!email) return fail(400, { step: 'password', email: '', message: 'Your sign-in timed out. Enter your password again.' });
		await auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } });
		setPendingLogin(cookies, email);
		return { step: 'code', email, sent: true };
	},

	restart: async ({ cookies }) => {
		clearPendingLogin(cookies);
		return { step: 'password', email: '' };
	}
};
