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
		printBufferDays: z.number().int().min(0).max(30),
		windowOverflowDays: z.number().int().min(0).max(10)
	})
	.partial()
	.extend({ preview: z.boolean().optional() })
	.refine((b) => Object.keys(b).some((k) => k !== 'preview'), 'Nothing to update.');

export const memberSchema = z.object({
	role: z.enum(['coordinator', 'contributor', 'viewer']),
	teamLabel: z.string().trim().max(60).nullable().transform((v) => v || null),
	capacity: z.number().min(0.25, 'Capacity must be at least 0.25.').max(20)
});

const windowFields = {
	label: z.string().trim().min(1, 'Enter a label for the window.').max(60),
	startDate: isoDate,
	endDate: isoDate
};
const endAfterStart = (w: { startDate?: string; endDate?: string }) => !w.startDate || !w.endDate || w.endDate >= w.startDate;

export const createWindowSchema = z
	.object({ ...windowFields, preview: z.boolean().optional() })
	.refine(endAfterStart, 'The window cannot end before it starts.');

export const updateWindowSchema = z
	.object({ ...windowFields, preview: z.boolean().optional() })
	.partial()
	.refine((b) => Object.keys(b).some((k) => k !== 'preview'), 'Nothing to update.')
	.refine(endAfterStart, 'The window cannot end before it starts.');

// ── Pipeline edits (spec: Pipeline changes) ────────────────────────────────

const someField = (b: object) => Object.keys(b).some((k) => k !== 'preview');

export const updateTrackSchema = z.object({ name: z.string().trim().min(1, 'Enter a track name.').max(60) });

export const deadlineRuleSchema = z
	.object({
		after: z.string().min(1, 'Choose the stage the deadline counts from.'),
		months: z.number().int().min(0).max(36).optional(),
		days: z.number().int().min(0).max(365).optional()
	})
	.refine((r) => (r.months ?? 0) + (r.days ?? 0) > 0, 'A deadline needs at least one month or day.');

export const updateStageSchema = z
	.object({
		name: z.string().trim().min(1, 'Enter a stage name.').max(60),
		category: z.enum(['creation', 'review', 'layout', 'publish', 'gate', 'production']),
		defaultDays: z.number().int().min(0).max(60),
		isReview: z.boolean(),
		isExternal: z.boolean(),
		ignoresWindows: z.boolean(),
		deadlineRule: deadlineRuleSchema.nullable(),
		preview: z.boolean()
	})
	.partial()
	.refine(someField, 'Nothing to update.');

export const updateBookSchema = z
	.object({
		code: z.string().trim().min(1, 'Enter a book code.').max(20),
		name: z.string().trim().min(1, 'Enter a book name.').max(120),
		groupLabel: z.string().trim().max(60).nullable().transform((v) => v || null),
		batch: z.number().int().min(1).max(99).nullable()
	})
	.partial()
	.refine(someField, 'Nothing to update.');

export const orderSchema = z.object({ ids: z.array(z.string().min(1)).min(1) });

export const addBookSchema = z.object({
	code: z.string().trim().min(1, 'Enter a book code.').max(20),
	name: z.string().trim().min(1, 'Enter a book name.').max(120),
	trackId: z.string().min(1, 'Choose a track.'),
	groupLabel: z.string().trim().max(60).nullable().optional().transform((v) => v || null),
	batch: z.number().int().min(1).max(99).nullable().optional(),
	schedule: z.union([
		z.object({ likeBookId: z.string().min(1) }),
		z.object({ fromDate: isoDate.optional(), skipStageIds: z.array(z.string()).optional() })
	]),
	preview: z.boolean().optional()
});
