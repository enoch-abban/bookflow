import { describe, expect, it } from 'vitest';
import { BLANK, definitionFrom, definitionSchema } from './definition.ts';

const stage = (id: string, key: string, sortOrder: number, extra: Partial<Parameters<typeof definitionFrom>[0]['stages'][number]> = {}) => ({
	id, key, name: key, category: 'creation' as const, sortOrder, defaultDays: 2, isReview: 0, isExternal: 0, ignoresWindows: 0,
	deadlineRule: null, archivedAt: null, ...extra,
});
const settings = { bookGroupLabel: 'Grade group', enforceWindows: 1, strictMode: 0, defaultCopies: 20, legalDepositCopies: 2, printBufferDays: 1, windowOverflowDays: 2 };

describe('template definitions', () => {
	const def = definitionFrom({
		tracks: [{ id: 't2', key: 'content', name: 'Content', sortOrder: 2 }, { id: 't1', key: 'image', name: 'Image', sortOrder: 1 }],
		stages: [
			stage('s2', 'review', 2, { category: 'review', isReview: 1 }),
			stage('s1', 'draw', 1),
			stage('s3', 'old', 3, { archivedAt: '2026-10-01' }),
		],
		stageTracks: [{ stageId: 's1', trackId: 't1' }, { stageId: 's2', trackId: 't1' }, { stageId: 's2', trackId: 't2' }, { stageId: 's3', trackId: 't1' }],
		links: [{ fromStageId: 's1', toStageId: 's2', lagDays: 0 }, { fromStageId: 's2', toStageId: 's3', lagDays: 0 }],
		teamLabels: ['Reviewer', '', ' Designer ', 'Reviewer'],
		settings,
	});

	it('keys everything by track and stage key, in order, leaving archived stages out', () => {
		expect(def.tracks.map((t) => t.key)).toEqual(['image', 'content']);
		expect(def.stages.map((s) => [s.key, s.trackKeys])).toEqual([['draw', ['image']], ['review', ['image', 'content']]]);
		expect(def.stages[1].isReview).toBe(true);
		expect(def.links).toEqual([{ from: 'draw', to: 'review', lagDays: 0 }]);
	});

	it('keeps team labels and settings', () => {
		expect(def.teamLabels).toEqual(['Designer', 'Reviewer']);
		expect(def.settings).toMatchObject({ bookGroupLabel: 'Grade group', enforceWindows: true, windowOverflowDays: 2 });
	});

	it('validates, and refuses definitions that point at missing tracks or stages', () => {
		expect(definitionSchema.safeParse(def).success).toBe(true);
		expect(definitionSchema.safeParse(BLANK).success).toBe(true);
		expect(definitionSchema.safeParse({ ...def, links: [{ from: 'draw', to: 'nope', lagDays: 0 }] }).success).toBe(false);
		expect(definitionSchema.safeParse({ ...def, stages: [{ ...def.stages[0], trackKeys: ['nope'] }] }).success).toBe(false);
	});
});
