import { describe, expect, it } from 'vitest';
import { stepsFor } from './steps.ts';

const ids = (...a: Parameters<typeof stepsFor>) => stepsFor(...a).map((s) => s.id);

describe('tour steps', () => {
	it('gives contributors the views and My tasks, without coordinator tools', () => {
		const got = ids({ seriesId: 's1', role: 'contributor', seriesCount: 1 });
		expect(got).toEqual(['welcome', 'matrix', 'strip', 'swimlane', 'critical', 'workload', 'me', 'done']);
	});

	it('adds scheduling tools for coordinators and admin pages for admins', () => {
		const coord = ids({ seriesId: 's1', role: 'coordinator', seriesCount: 2 });
		expect(coord).toEqual(expect.arrayContaining(['series', 'undo', 'baselines', 'activity', 'settings']));
		expect(coord).not.toContain('templates');
		expect(ids({ seriesId: 's1', role: 'admin', seriesCount: 1 })).toEqual(expect.arrayContaining(['series', 'templates', 'admin']));
	});

	it('leaves out series pages when there is no series, and My tasks for viewers', () => {
		expect(ids({ seriesId: null, role: 'admin', seriesCount: 0 })).toEqual(['welcome', 'series', 'me', 'templates', 'admin', 'done']);
		expect(ids({ seriesId: 's1', role: 'viewer', seriesCount: 1 })).not.toContain('me');
	});

	it('builds paths for the open series', () => {
		const steps = stepsFor({ seriesId: 's1', role: 'admin', seriesCount: 1 });
		const ctx = { seriesId: 's1', role: 'admin' as const, seriesCount: 1 };
		expect(steps.find((s) => s.id === 'workload')!.path(ctx)).toBe('/s/s1/workload');
		expect(steps.find((s) => s.id === 'welcome')!.path(ctx)).toBeNull();
	});
});
