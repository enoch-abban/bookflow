import { Resend } from 'resend';
import { RESEND_API_KEY, EMAIL_FROM } from '$app/env/private';

type Mail = { to: string; subject: string; text: string };

let resend: Resend | null = null;

/** Send a transactional email. Without RESEND_API_KEY it is logged instead (local dev). */
export async function sendEmail({ to, subject, text }: Mail): Promise<void> {
	if (!RESEND_API_KEY) {
		console.info(`\n[email] to: ${to}\n[email] subject: ${subject}\n${text}\n`);
		return;
	}
	resend ??= new Resend(RESEND_API_KEY);
	// Resend reports failures in the result rather than throwing.
	const { error } = await resend.emails.send({ from: EMAIL_FROM, to, subject, text });
	if (error) throw new Error(`Email to ${to} failed: ${error.message}`);
}

export function sendOtpEmail(to: string, otp: string, type: string) {
	const purpose =
		type === 'sign-in' ? 'sign-in' : type === 'email-verification' ? 'verification' : 'password reset';
	const subject =
		type === 'sign-in' ? 'Your sign-in code' : type === 'email-verification' ? 'Verify your email' : 'Your password reset code';
	return sendEmail({
		to,
		subject,
		text: `Your bookflow ${purpose} code is: ${otp}\n\nThis code expires in 10 minutes. If you did not request it, you can ignore this email.`
	});
}

export function sendInviteEmail(to: string, link: string, inviterName: string) {
	return sendEmail({
		to,
		subject: `${inviterName} invited you to bookflow`,
		text:
			`${inviterName} has invited you to bookflow.\n\n` +
			`Set up your account here:\n${link}\n\n` +
			`This link can be used once and expires in 7 days.`
	});
}

export function sendResetEmail(to: string, link: string) {
	return sendEmail({
		to,
		subject: 'Reset your bookflow password',
		text:
			`Someone asked to reset the password for this bookflow account.\n\n` +
			`Choose a new password here:\n${link}\n\n` +
			`This link can be used once and expires in 30 minutes. If you did not ask for this, ignore this email.`
	});
}
