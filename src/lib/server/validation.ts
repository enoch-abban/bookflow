import { error } from '@sveltejs/kit';
import { z } from 'zod';

const displayName = z
	.string()
	.trim()
	.min(1, 'Enter a display name.')
	.max(80, 'Display name must be 80 characters or fewer.');

export const password = z
	.string()
	.min(10, 'Password must be at least 10 characters.')
	.max(128, 'Password must be 128 characters or fewer.');

const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.'));

export const acceptSchema = z.object({ token: z.string().min(1), displayName, password });

export const createPersonSchema = z.object({
	displayName,
	email: email.optional().or(z.literal('').transform(() => undefined)),
	seriesId: z.string().optional(),
	role: z.enum(['coordinator', 'contributor', 'viewer']).default('contributor'),
	teamLabel: z.string().trim().max(60).optional()
});

export const updatePersonSchema = z
	.object({ displayName: displayName.optional(), active: z.boolean().optional() })
	.refine((b) => b.displayName !== undefined || b.active !== undefined, 'Nothing to update.');

export const inviteSchema = z.object({ email });

/** Parse with a schema or throw 400 with the first issue's message. */
export function parseOr400<T>(schema: z.ZodType<T>, data: unknown): T {
	const result = schema.safeParse(data);
	if (!result.success) throw error(400, result.error.issues[0].message);
	return result.data;
}

const isoDate = z.iso.date('Use a YYYY-MM-DD date.');

export const updateSeriesSchema = z
	.object({
		name: z.string().trim().min(1, 'Enter a series name.').max(120),
		targetDate: isoDate,
		hardLimitDate: isoDate.nullable(),
		status: z.enum(['planning', 'active', 'closed']),
		bookGroupLabel: z.string().trim().min(1, 'Enter a label for book groups.').max(40),
		enforceWindows: z.boolean(),
		strictMode: z.boolean(),
		defaultCopies: z.number().int().min(0).max(100000),
		legalDepositCopies: z.number().int().min(0).max(1000),
		printBufferDays: z.number().int().min(0).max(30)
	})
	.partial()
	.refine((b) => Object.keys(b).length > 0, 'Nothing to update.');

export const memberSchema = z.object({
	role: z.enum(['coordinator', 'contributor', 'viewer']),
	teamLabel: z.string().trim().max(60).nullable().transform((v) => v || null),
	capacity: z.number().min(0.25, 'Capacity must be at least 0.25.').max(20)
});
