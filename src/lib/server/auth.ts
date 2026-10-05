import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { emailOTP } from 'better-auth/plugins';
import { getRequestEvent } from '$app/server';
import { env } from '$env/dynamic/private';
import { db } from '#lib/server/db/index.ts';
import { Resend } from 'resend';

let resend: Resend | null = null;
function getResend() {
	if (!resend) resend = new Resend(env.RESEND_API_KEY);
	return resend;
}

export const auth = betterAuth({
	baseURL: env.ORIGIN,
	secret: env.BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, { provider: 'sqlite' }),
	emailAndPassword: {
		enabled: true,
		minPasswordLength: 10
	},
	session: {
		expiresIn: 60 * 60 * 24 * 7, // 7 days
		updateAge: 60 * 60 * 24 // refresh if older than 1 day
	},
	plugins: [
		emailOTP({
			otpLength: 6,
			expiresIn: 10 * 60, // 10 minutes
			async sendVerificationOTP({ email, otp, type }) {
				const subject =
					type === 'sign-in'
						? 'Your sign-in code'
						: type === 'email-verification'
							? 'Verify your email'
							: 'Your password reset code';
				await getResend().emails.send({
					from: 'bookflow <noreply@bookflow.app>',
					to: email,
					subject,
					text: `Your ${type === 'sign-in' ? 'sign-in' : 'verification'} code is: ${otp}\n\nThis code expires in 10 minutes.`
				});
			}
		}),
		sveltekitCookies(getRequestEvent)
	]
});
