import { fail } from '@sveltejs/kit';
import type { Actions } from './$types';
import { auth } from '#lib/server/auth.ts';

export const actions: Actions = {
	default: async ({ request }) => {
		const email = (await request.formData()).get('email')?.toString().trim().toLowerCase() ?? '';
		if (!email) return fail(400, { email, message: 'Enter your email address.' });
		try {
			await auth.api.requestPasswordReset({ body: { email } });
		} catch (err) {
			// Same response either way so the page never reveals which emails have accounts.
			console.error('Password reset request failed', err);
		}
		return { sent: true, email };
	}
};
