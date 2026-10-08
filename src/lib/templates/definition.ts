// Template definitions (spec: Template): a saved pipeline that a new series can start from.
// Everything is keyed by track and stage key, not id, so it applies to any series. Windows
// are left out on purpose: their dates belong to one run.

import { z } from 'zod';

const CATEGORIES = ['creation', 'review', 'layout', 'publish', 'gate', 'production'] as const;
const key = z.string().trim().min(1).max(60);

export const definitionSchema = z.object({
	version: z.literal(1),
	tracks: z.array(z.object({ key, name: z.string().min(1).max(60) })),
	stages: z.array(z.object({
		key,
		name: z.string().min(1).max(60),
		category: z.enum(CATEGORIES),
		defaultDays: z.number().int().min(0).max(60),
		isReview: z.boolean(),
		isExternal: z.boolean(),
		ignoresWindows: z.boolean(),
		deadlineRule: z.string().nullable(),
		trackKeys: z.array(key),
	})),
	links: z.array(z.object({ from: key, to: key, lagDays: z.number().int() })),
	teamLabels: z.array(z.string().min(1).max(60)),
	settings: z.object({
		bookGroupLabel: z.string().min(1).max(40),
		enforceWindows: z.boolean(),
		strictMode: z.boolean(),
		defaultCopies: z.number().int().min(0),
		legalDepositCopies: z.number().int().min(0),
		printBufferDays: z.number().int().min(0),
		windowOverflowDays: z.number().int().min(0),
	}),
}).superRefine((d, ctx) => {
	const tracks = new Set(d.tracks.map((t) => t.key));
	const stages = new Set(d.stages.map((s) => s.key));
	if (tracks.size !== d.tracks.length) ctx.addIssue({ code: 'custom', message: 'Track keys must be unique.' });
	if (stages.size !== d.stages.length) ctx.addIssue({ code: 'custom', message: 'Stage keys must be unique.' });
	for (const s of d.stages)
		if (s.trackKeys.some((k) => !tracks.has(k))) ctx.addIssue({ code: 'custom', message: `Stage ${s.name} is on a track the template does not have.` });
	for (const l of d.links)
		if (!stages.has(l.from) || !stages.has(l.to)) ctx.addIssue({ code: 'custom', message: 'A link points at a stage the template does not have.' });
});
export type Definition = z.infer<typeof definitionSchema>;

type TrackRow = { id: string; key: string; name: string; sortOrder: number };
type StageRow = {
	id: string; key: string; name: string; category: (typeof CATEGORIES)[number]; sortOrder: number; defaultDays: number;
	isReview: number; isExternal: number; ignoresWindows: number; deadlineRule: string | null; archivedAt: string | null;
};
type SeriesSettings = {
	bookGroupLabel: string; enforceWindows: number; strictMode: number; defaultCopies: number;
	legalDepositCopies: number; printBufferDays: number; windowOverflowDays: number;
};

/** A series' live pipeline as a template definition. Archived stages and their links are left out. */
export function definitionFrom(input: {
	tracks: TrackRow[]; stages: StageRow[]; stageTracks: { stageId: string; trackId: string }[];
	links: { fromStageId: string; toStageId: string; lagDays: number }[]; teamLabels: string[]; settings: SeriesSettings;
}): Definition {
	const tracks = [...input.tracks].sort((a, b) => a.sortOrder - b.sortOrder);
	const trackKey = new Map(tracks.map((t) => [t.id, t.key]));
	const live = input.stages.filter((s) => !s.archivedAt).sort((a, b) => a.sortOrder - b.sortOrder);
	const stageKey = new Map(live.map((s) => [s.id, s.key]));
	const s = input.settings;
	return {
		version: 1,
		tracks: tracks.map((t) => ({ key: t.key, name: t.name })),
		stages: live.map((st) => ({
			key: st.key, name: st.name, category: st.category, defaultDays: st.defaultDays,
			isReview: !!st.isReview, isExternal: !!st.isExternal, ignoresWindows: !!st.ignoresWindows, deadlineRule: st.deadlineRule,
			trackKeys: input.stageTracks.filter((x) => x.stageId === st.id).map((x) => trackKey.get(x.trackId)).filter((k): k is string => !!k),
		})),
		links: input.links
			.filter((l) => stageKey.has(l.fromStageId) && stageKey.has(l.toStageId))
			.map((l) => ({ from: stageKey.get(l.fromStageId)!, to: stageKey.get(l.toStageId)!, lagDays: l.lagDays })),
		teamLabels: [...new Set(input.teamLabels.map((l) => l.trim()).filter(Boolean))].sort(),
		settings: {
			bookGroupLabel: s.bookGroupLabel, enforceWindows: !!s.enforceWindows, strictMode: !!s.strictMode,
			defaultCopies: s.defaultCopies, legalDepositCopies: s.legalDepositCopies, printBufferDays: s.printBufferDays,
			windowOverflowDays: s.windowOverflowDays,
		},
	};
}

/** The blank pipeline: one track, no stages, default settings. */
export const BLANK: Definition = {
	version: 1,
	tracks: [{ key: 'main', name: 'Main track' }],
	stages: [],
	links: [],
	teamLabels: [],
	settings: {
		bookGroupLabel: 'Group', enforceWindows: false, strictMode: false, defaultCopies: 20,
		legalDepositCopies: 0, printBufferDays: 1, windowOverflowDays: 0,
	},
};

/** Counts for a template card. */
export function summary(d: Definition) {
	return { tracks: d.tracks.length, stages: d.stages.length, links: d.links.length, teamLabels: d.teamLabels.length };
}
