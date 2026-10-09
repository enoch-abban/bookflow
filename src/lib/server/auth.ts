import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { emailOTP } from 'better-auth/plugins';
import { getRequestEvent } from '$app/server';
import { ORIGIN, BETTER_AUTH_SECRET } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { sendOtpEmail, sendResetEmail } from '#lib/server/email.ts';
import { linkVerifiedUser } from '#lib/server/invites.ts';

export const auth = betterAuth({
	baseURL: ORIGIN,
	secret: BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, { provider: 'sqlite' }),
	emailAndPassword: {
		enabled: true,
		// Accounts are only created by accepting an invite (see accounts.ts).
		disableSignUp: true,
		minPasswordLength: 10,
		resetPasswordTokenExpiresIn: 30 * 60,
		revokeSessionsOnPasswordReset: true,
		async sendResetPassword({ user, token }) {
			await sendResetEmail(user.email, `${ORIGIN}/reset-password/${token}`);
		}
	},
	emailVerification: {
		autoSignInAfterVerification: true,
		async afterEmailVerification(user) {
			await linkVerifiedUser(user);
		}
	},
	session: {
		expiresIn: 60 * 60 * 24 * 7, // 7 days
		updateAge: 60 * 60 * 24, // refresh if older than 1 day
		// Keep the session in a signed cookie for 5 minutes, so most requests skip the session
		// lookup (a database round trip). A deactivated person is still refused at once:
		// resolvePerson checks that they are active on every request.
		cookieCache: { enabled: true, maxAge: 5 * 60 }
	},
	// Sign-in needs password AND emailed code, so the single-factor routes are only
	// reachable server-side through the /login and /invite form actions.
	disabledPaths: [
		'/sign-up/email',
		'/sign-in/email',
		'/sign-in/email-otp',
		'/email-otp/send-verification-otp',
		'/email-otp/verify-email',
		'/email-otp/check-verification-otp',
		'/email-otp/request-password-reset',
		'/forget-password/email-otp',
		'/email-otp/reset-password',
		'/email-otp/request-email-change',
		'/email-otp/change-email',
		'/request-password-reset',
		'/reset-password',
		'/change-email',
		'/delete-user'
	],
	plugins: [
		emailOTP({
			otpLength: 6,
			expiresIn: 10 * 60, // 10 minutes
			disableSignUp: true,
			storeOTP: 'hashed',
			async sendVerificationOTP({ email, otp, type }) {
				await sendOtpEmail(email, otp, type);
			}
		}),
		sveltekitCookies(getRequestEvent)
	]
});
