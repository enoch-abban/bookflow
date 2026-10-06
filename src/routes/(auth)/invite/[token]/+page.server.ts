import { fail, isHttpError, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '#lib/server/auth.ts';
import { requireOpenInvite } from '#lib/server/invites.ts';
import {
	createInvitedAccount,
	hasUnverifiedAccount,
	otpErrorMessage,
	sendVerificationCode
} from '#lib/server/accounts.ts';
import { acceptSchema } from '#lib/server/validation.ts';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (locals.user) throw redirect(303, '/');
	const { invite, person } = await requireOpenInvite(params.token);
	return {
		email: invite.email,
		displayName: person.displayName,
		awaitingCode: await hasUnverifiedAccount(invite.email)
	};
};

export const actions: Actions = {
	details: async ({ request, params }) => {
		const { invite } = await requireOpenInvite(params.token);
		const form = await request.formData();
		const displayName = form.get('displayName')?.toString() ?? '';
		const password = form.get('password')?.toString() ?? '';

		if (password !== form.get('confirm')?.toString())
			return fail(400, { step: 'details', displayName, message: 'The two passwords do not match.' });

		const parsed = acceptSchema.safeParse({ token: params.token, displayName, password });
		if (!parsed.success)
			return fail(400, { step: 'details', displayName, message: parsed.error.issues[0].message });

		try {
			await createInvitedAccount(invite.email, parsed.data.displayName, parsed.data.password);
		} catch (err) {
			if (isHttpError(err)) return fail(err.status, { step: 'details', displayName, message: err.body.message });
			throw err;
		}
		return { step: 'code' };
	},

	code: async ({ request, params }) => {
		const { invite } = await requireOpenInvite(params.token);
		const otp = (await request.formData()).get('code')?.toString().replace(/\s/g, '') ?? '';
		try {
			// Marks the email verified, links the person (afterEmailVerification) and signs in.
			await auth.api.verifyEmailOTP({ body: { email: invite.email, otp }, headers: request.headers });
		} catch (err) {
			if (isHttpError(err)) return fail(err.status, { step: 'code', message: err.body.message });
			return fail(400, { step: 'code', message: otpErrorMessage(err) });
		}
		throw redirect(303, '/me');
	},

	resend: async ({ params }) => {
		const { invite } = await requireOpenInvite(params.token);
		if (!(await hasUnverifiedAccount(invite.email))) return { step: 'details' };
		await sendVerificationCode(invite.email);
		return { step: 'code', sent: true };
	},

	restart: async () => ({ step: 'details' })
};
