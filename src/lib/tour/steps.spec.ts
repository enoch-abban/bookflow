import { describe, expect, it } from 'vitest';
import { autoTour, stepsFor, TOUR_VERSION } from './steps.ts';

const ids = (...a: Parameters<typeof stepsFor>) => stepsFor(...a).map((s) => s.id);

describe('tour steps', () => {
	it('gives contributors the views and My tasks, without coordinator tools', () => {
		const got = ids({ seriesId: 's1', role: 'contributor', seriesCount: 1 });
		expect(got).toEqual(['welcome', 'matrix', 'filters', 'drawer', 'strip', 'swimlane', 'critical', 'workload', 'me', 'account', 'done']);
	});

	it('adds scheduling tools for coordinators and admin pages for admins', () => {
		const coord = ids({ seriesId: 's1', role: 'coordinator', seriesCount: 2 });
		expect(coord).toEqual(expect.arrayContaining(['series', 'undo', 'baselines', 'activity', 'settings']));
		expect(coord).not.toContain('templates');
		expect(ids({ seriesId: 's1', role: 'admin', seriesCount: 1 })).toEqual(expect.arrayContaining(['series', 'templates', 'admin']));
	});

	it('gives managers templates and people, but not the admin-only calendar step', () => {
		const got = ids({ seriesId: 's1', role: 'manager', seriesCount: 1 });
		expect(got).toEqual(expect.arrayContaining(['series', 'undo', 'settings', 'templates', 'people']));
		expect(got).not.toContain('admin');
	});

	it('leaves out series pages when there is no series, and My tasks for viewers', () => {
		expect(ids({ seriesId: null, role: 'admin', seriesCount: 0 })).toEqual(['welcome', 'series', 'me', 'templates', 'roles', 'transfer', 'admin', 'account', 'done']);
		expect(ids({ seriesId: 's1', role: 'viewer', seriesCount: 1 })).not.toContain('me');
	});

	it('builds paths for the open series', () => {
		const steps = stepsFor({ seriesId: 's1', role: 'admin', seriesCount: 1 });
		const ctx = { seriesId: 's1', role: 'admin' as const, seriesCount: 1 };
		expect(steps.find((s) => s.id === 'workload')!.path(ctx)).toBe('/s/s1/workload');
		expect(steps.find((s) => s.id === 'welcome')!.path(ctx)).toBeNull();
	});

	it('gives coordinators the drawer assignees and drag-to-reassign steps, admins roles and transfer', () => {
		expect(ids({ seriesId: 's1', role: 'coordinator', seriesCount: 1 })).toEqual(expect.arrayContaining(['drawer-assignees', 'reassign']));
		expect(ids({ seriesId: 's1', role: 'contributor', seriesCount: 1 })).not.toContain('reassign');
		expect(ids({ seriesId: 's1', role: 'admin', seriesCount: 1 })).toEqual(expect.arrayContaining(['roles', 'transfer']));
	});

	it('starts the full tour for newcomers, only the new steps for returning people, nothing when up to date', () => {
		const ctx = { seriesId: 's1', role: 'contributor' as const, seriesCount: 1 };
		expect(autoTour(ctx, 0).map((s) => s.id)).toEqual(stepsFor(ctx).map((s) => s.id));
		expect(autoTour(ctx, 1).map((s) => s.id)).toEqual(['whats-new', 'filters', 'drawer', 'account', 'done']);
		expect(autoTour(ctx, TOUR_VERSION)).toEqual([]);
	});
});
