import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '#lib/server/auth.ts';
import { password as passwordSchema } from '#lib/server/validation.ts';

export const load: PageServerLoad = async ({ params }) => {
	// Peek without consuming, so an expired or used link says so before the form is filled in.
	const ctx = await auth.$context;
	const row = await ctx.internalAdapter.findVerificationValue(`reset-password:${params.token}`);
	return { valid: !!row && row.expiresAt > new Date() };
};

export const actions: Actions = {
	default: async ({ request, params }) => {
		const form = await request.formData();
		const newPassword = form.get('password')?.toString() ?? '';
		if (newPassword !== form.get('confirm')?.toString()) return fail(400, { message: 'The two passwords do not match.' });

		const parsed = passwordSchema.safeParse(newPassword);
		if (!parsed.success) return fail(400, { message: parsed.error.issues[0].message });

		try {
			// Also ends every session for the account (revokeSessionsOnPasswordReset).
			await auth.api.resetPassword({ body: { newPassword, token: params.token } });
		} catch {
			return fail(400, { message: 'This reset link has expired or was already used. Request a new one.' });
		}
		throw redirect(303, '/login?reset=1');
	}
};
