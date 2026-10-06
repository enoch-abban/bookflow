// Run: npm run db:seed  (on a freshly migrated, empty database)
// Loads eSTEAM L2 from Rev 5 as described in spec.md, "Seed data from Rev 5".
import { readFileSync } from 'node:fs';

// Load .env before any other code runs
try {
	for (const line of readFileSync('.env', 'utf8').split('\n')) {
		const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)/);
		if (m) (process.env as Record<string, string>)[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, '');
	}
} catch { /* .env not found — rely on process.env */ }

import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { ulid } from 'ulid';
import {
	series as seriesTable,
	tracks,
	stages,
	stageTracks,
	books,
	windows as windowsTable,
	people,
	seriesMembers,
	tasks,
	taskAssignees,
	dependencies,
	baselines,
	baselineTasks,
	activityLog,
} from '../schema.ts';
import { checkExplicitMove, isWorkingDay, type WindowRules } from '../../scheduler.ts';

const client = createClient({ url: process.env.DATABASE_URL! });
const db = drizzle(client);
const NOW = new Date().toISOString();

/** Working days from start to end, both included. */
function workingDays(start: string, end: string): number {
	let n = 0;
	for (const d = new Date(start + 'T12:00:00Z'); d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 1))
		if (isWorkingDay(d.toISOString().slice(0, 10))) n++;
	return n;
}

// ─── IDs ──────────────────────────────────────────────────────────────────────

const SERIES = ulid();

const TRK = { img: ulid(), cnt: ulid() };

const ST: Record<string, string> = Object.fromEntries(
	[
		'image_generation', 'image_review', 'overall_review',
		'content_work', 'content_images_review',
		'indesign', 'post_layout_review', 'correction_iteration',
		'manuscript_submission', 'agency_review', 'isbn_issued',
		'print_approval', 'printing', 'binding', 'legal_deposit',
	].map((k) => [k, ulid()])
);

const BK: Record<string, string> = Object.fromEntries(
	['G9','G8','G7','G6','G5','G4','G3','G2','G1','KG2','KG1','N2','N1'].map((k) => [k, ulid()])
);

const P: Record<string, string> = Object.fromEntries(
	['et1','et2','et3','rv1','rv2','rv3','rv4','ds1','ds2','ds3','prd','bnd'].map((k) => [k, ulid()])
);

// ─── Windows: the 15 Rev 5 date bands, then one reserve window per working week ─

const WINDOW_DEFS: [label: string, start: string, end: string][] = [
	['Oct 1 to 2',         '2026-10-01', '2026-10-02'],
	['Oct 5 to 8',         '2026-10-05', '2026-10-08'],
	['Oct 9 to 14',        '2026-10-09', '2026-10-14'],
	['Oct 15 to 19',       '2026-10-15', '2026-10-19'],
	['Oct 20 to 21',       '2026-10-20', '2026-10-21'],
	['Oct 22 to 26',       '2026-10-22', '2026-10-26'],
	['Oct 27 to 28',       '2026-10-27', '2026-10-28'],
	['Oct 29 to Nov 2',    '2026-10-29', '2026-11-02'],
	['Nov 3 to 4',         '2026-11-03', '2026-11-04'],
	['Nov 5 to 9',         '2026-11-05', '2026-11-09'],
	['Nov 10 to 11',       '2026-11-10', '2026-11-11'],
	['Nov 12 to 16',       '2026-11-12', '2026-11-16'],
	['Nov 17 to 18',       '2026-11-17', '2026-11-18'],
	['Nov 19 to 20',       '2026-11-19', '2026-11-20'],
	['Nov 23 to 24',       '2026-11-23', '2026-11-24'],
	['Reserve: Nov 25 to 27',       '2026-11-25', '2026-11-27'],
	['Reserve: Nov 30 to Dec 4',    '2026-11-30', '2026-12-04'],
	['Reserve: Dec 7 to 11',        '2026-12-07', '2026-12-11'],
	['Reserve: Dec 14 to 15',       '2026-12-14', '2026-12-15'],
];
const WINDOWS = WINDOW_DEFS.map(([label, startDate, endDate], i) => ({
	id: ulid(), seriesId: SERIES, label, startDate, endDate, sortOrder: i + 1,
}));

const OVERFLOW_DAYS = 2;

// ─── Seed ─────────────────────────────────────────────────────────────────────

async function main() {
	const existing = await db.select({ id: seriesTable.id }).from(seriesTable).limit(1);
	if (existing.length) {
		console.error('This database already has a series. Seed a fresh one: delete the file, run `npm run db:migrate`, then `npm run db:seed`.');
		process.exit(1);
	}

	console.log('Seeding eSTEAM L2…');

	await db.insert(seriesTable).values({
		id: SERIES,
		name: 'eSTEAM L2',
		status: 'active',
		startDate: '2026-10-01',
		targetDate: '2026-11-24',
		hardLimitDate: '2026-12-15',
		bookGroupLabel: 'Grade group',
		enforceWindows: 1,
		strictMode: 0,
		defaultCopies: 20,
		legalDepositCopies: 2,
		printBufferDays: 1,
		windowOverflowDays: OVERFLOW_DAYS,
	});

	// ── Tracks ─────────────────────────────────────────────────────────────────

	await db.insert(tracks).values([
		{ id: TRK.img, seriesId: SERIES, key: 'image',   name: 'Image Track',   sortOrder: 1 },
		{ id: TRK.cnt, seriesId: SERIES, key: 'content', name: 'Content Track', sortOrder: 2 },
	]);

	// ── Stages ─────────────────────────────────────────────────────────────────

	type Cat = 'creation' | 'review' | 'layout' | 'publish' | 'gate' | 'production';
	type StageTuple = [string, string, Cat, number, number, number?, number?, number?];

	// Only publishing stages ignore windows: they run on the ISBN agency's clock.
	// Gates (0 days) never sit in a window anyway.
	const stageDefs: StageTuple[] = [
		// [key, name, category, sortOrder, defaultDays, isReview?, isExternal?, ignoresWindows?]
		['image_generation',      'Image Generation',      'creation',   1,  5],
		['image_review',          'Image Review',          'review',     2,  2, 1],
		['overall_review',        'Overall Review',        'review',     3,  4, 1],
		['content_work',          'Content Work',          'creation',   4,  7],
		['content_images_review', 'Content Images Review', 'review',     5,  2, 1],
		['indesign',              'InDesign',              'layout',     6,  5],
		['post_layout_review',    'Post-Layout Review',    'review',     7,  2, 1],
		['correction_iteration',  'Correction Iteration',  'layout',     8,  2],
		['manuscript_submission', 'Manuscript Submission', 'publish',    9,  1, 0, 0, 1],
		['agency_review',         'Agency Review',         'review',     10, 5, 1, 1, 1],
		['isbn_issued',           'ISBN Issued',           'publish',    11, 1, 0, 0, 1],
		['print_approval',        'Print Approval',        'gate',       12, 0],
		['printing',              'Printing',              'production', 13, 3],
		['binding',               'Binding',               'production', 14, 2],
		['legal_deposit',         'Legal Deposit',         'production', 15, 1],
	];
	const stageName = Object.fromEntries(stageDefs.map(([key, name]) => [key, name]));

	await db.insert(stages).values(
		stageDefs.map(([key, name, category, sortOrder, defaultDays, isReview = 0, isExternal = 0, ignoresWindows = 0]) => ({
			id: ST[key], seriesId: SERIES, key, name, category, sortOrder, defaultDays,
			isReview, isExternal, ignoresWindows,
		}))
	);

	// ── Stage–Track links ──────────────────────────────────────────────────────

	const IMG_ONLY = ['image_generation', 'image_review', 'overall_review'];
	const CNT_ONLY = ['content_work', 'content_images_review'];
	const BOTH = [
		'indesign', 'post_layout_review', 'correction_iteration',
		'manuscript_submission', 'agency_review', 'isbn_issued',
		'print_approval', 'printing', 'binding', 'legal_deposit',
	];

	await db.insert(stageTracks).values([
		...IMG_ONLY.map((k) => ({ stageId: ST[k], trackId: TRK.img })),
		...CNT_ONLY.map((k) => ({ stageId: ST[k], trackId: TRK.cnt })),
		...BOTH.flatMap((k) => [
			{ stageId: ST[k], trackId: TRK.img },
			{ stageId: ST[k], trackId: TRK.cnt },
		]),
	]);

	// ── Books ──────────────────────────────────────────────────────────────────

	await db.insert(books).values([
		{ id: BK.G9,  seriesId: SERIES, trackId: TRK.img, code: 'G9',  name: 'Grade 9',        groupLabel: 'JHS',       batch: 1, sortOrder: 1  },
		{ id: BK.G8,  seriesId: SERIES, trackId: TRK.img, code: 'G8',  name: 'Grade 8',        groupLabel: 'JHS',       batch: 1, sortOrder: 2  },
		{ id: BK.G7,  seriesId: SERIES, trackId: TRK.img, code: 'G7',  name: 'Grade 7',        groupLabel: 'JHS',       batch: 1, sortOrder: 3  },
		{ id: BK.G6,  seriesId: SERIES, trackId: TRK.img, code: 'G6',  name: 'Grade 6',        groupLabel: 'Upper',     batch: 2, sortOrder: 4  },
		{ id: BK.G5,  seriesId: SERIES, trackId: TRK.img, code: 'G5',  name: 'Grade 5',        groupLabel: 'Upper',     batch: 2, sortOrder: 5  },
		{ id: BK.G4,  seriesId: SERIES, trackId: TRK.img, code: 'G4',  name: 'Grade 4',        groupLabel: 'Upper',     batch: 2, sortOrder: 6  },
		{ id: BK.G3,  seriesId: SERIES, trackId: TRK.img, code: 'G3',  name: 'Grade 3',        groupLabel: 'Lower',     batch: 3, sortOrder: 7  },
		{ id: BK.G2,  seriesId: SERIES, trackId: TRK.img, code: 'G2',  name: 'Grade 2',        groupLabel: 'Lower',     batch: 3, sortOrder: 8  },
		{ id: BK.G1,  seriesId: SERIES, trackId: TRK.img, code: 'G1',  name: 'Grade 1',        groupLabel: 'Lower',     batch: 3, sortOrder: 9  },
		{ id: BK.KG2, seriesId: SERIES, trackId: TRK.cnt, code: 'KG2', name: 'Kindergarten 2', groupLabel: 'Preschool', batch: 4, sortOrder: 10 },
		{ id: BK.KG1, seriesId: SERIES, trackId: TRK.cnt, code: 'KG1', name: 'Kindergarten 1', groupLabel: 'Preschool', batch: 4, sortOrder: 11 },
		{ id: BK.N2,  seriesId: SERIES, trackId: TRK.cnt, code: 'N2',  name: 'Nursery 2',      groupLabel: 'Preschool', batch: 4, sortOrder: 12 },
		{ id: BK.N1,  seriesId: SERIES, trackId: TRK.cnt, code: 'N1',  name: 'Nursery 1',      groupLabel: 'Preschool', batch: 5, sortOrder: 13 },
	]);

	// ── Windows ────────────────────────────────────────────────────────────────

	await db.insert(windowsTable).values(WINDOWS);

	// ── People ─────────────────────────────────────────────────────────────────

	await db.insert(people).values([
		{ id: P.et1, displayName: 'EdTech 1',        email: 'edtech1@example.com',    isAdmin: 1, active: 1 },
		{ id: P.et2, displayName: 'EdTech 2',        email: 'edtech2@example.com',    isAdmin: 0, active: 1 },
		{ id: P.et3, displayName: 'EdTech 3',        email: 'edtech3@example.com',    isAdmin: 0, active: 1 },
		{ id: P.rv1, displayName: 'Rev 1',           email: 'rev1@example.com',       isAdmin: 0, active: 1 },
		{ id: P.rv2, displayName: 'Rev 2',           email: 'rev2@example.com',       isAdmin: 0, active: 1 },
		{ id: P.rv3, displayName: 'Rev 3',           email: 'rev3@example.com',       isAdmin: 0, active: 1 },
		{ id: P.rv4, displayName: 'Rev 4',           email: 'rev4@example.com',       isAdmin: 0, active: 1 },
		{ id: P.ds1, displayName: 'Designer 1',      email: 'designer1@example.com',  isAdmin: 0, active: 1 },
		{ id: P.ds2, displayName: 'Designer 2',      email: 'designer2@example.com',  isAdmin: 0, active: 1 },
		{ id: P.ds3, displayName: 'Designer 3',      email: 'designer3@example.com',  isAdmin: 0, active: 1 },
		{ id: P.prd, displayName: 'Production Unit', email: 'production@example.com', isAdmin: 0, active: 1 },
		{ id: P.bnd, displayName: 'External Binder', email: null,                     isAdmin: 0, active: 1 },
	]);

	// ── Series Members ─────────────────────────────────────────────────────────
	// Roles are per series; the project manager (coordinator) is named by the admin later.
	// The binder is a vendor tracked by Production, not a user.

	await db.insert(seriesMembers).values([
		{ seriesId: SERIES, personId: P.et1, role: 'contributor', teamLabel: 'EdTech',     capacity: 1 },
		{ seriesId: SERIES, personId: P.et2, role: 'contributor', teamLabel: 'EdTech',     capacity: 1 },
		{ seriesId: SERIES, personId: P.et3, role: 'contributor', teamLabel: 'EdTech',     capacity: 1 },
		{ seriesId: SERIES, personId: P.rv1, role: 'contributor', teamLabel: 'Reviewer',   capacity: 1 },
		{ seriesId: SERIES, personId: P.rv2, role: 'contributor', teamLabel: 'Reviewer',   capacity: 1 },
		{ seriesId: SERIES, personId: P.rv3, role: 'contributor', teamLabel: 'Reviewer',   capacity: 1 },
		{ seriesId: SERIES, personId: P.rv4, role: 'contributor', teamLabel: 'Reviewer',   capacity: 1 },
		{ seriesId: SERIES, personId: P.ds1, role: 'contributor', teamLabel: 'Designer',   capacity: 1 },
		{ seriesId: SERIES, personId: P.ds2, role: 'contributor', teamLabel: 'Designer',   capacity: 1 },
		{ seriesId: SERIES, personId: P.ds3, role: 'contributor', teamLabel: 'Designer',   capacity: 1 },
		{ seriesId: SERIES, personId: P.prd, role: 'contributor', teamLabel: 'Production', capacity: 2 },
		{ seriesId: SERIES, personId: P.bnd, role: 'viewer',      teamLabel: 'Vendor',     capacity: 1 },
	]);

	// ── Tasks (Rev 5) ──────────────────────────────────────────────────────────
	// Dates are from the spec's batch table. Durations are derived from them.
	// Status as of the seed date (2026-10-05): batch 1 image review done; batch 2
	// image review and batch 3 image generation in progress; everything else not started.

	type Status = 'not_started' | 'in_progress' | 'done';
	// rev5: the Rev 5 dates when the seeded plan differs from them (kept in the baseline for variance).
	type TDef = { bc: string; sk: string; s: string; e: string; st?: Status; aa: string[]; overflow?: boolean; rev5?: [string, string] };

	// Designers take one book per batch each, in Rev 5 order.
	const designer = (i: number) => ['ds1', 'ds2', 'ds3'][i % 3];
	const postLayout = ['rv1', 'rv2', 'rv3'];

	// Shared tail for every book: layout, post-layout review, printing, binding, legal deposit.
	const tail = (bc: string, i: number, d: { ind: [string, string]; plr: [string, string]; prn: [string, string]; bnd: [string, string]; dep: string }): TDef[] => [
		{ bc, sk: 'indesign',           s: d.ind[0], e: d.ind[1], aa: [designer(i)] },
		{ bc, sk: 'post_layout_review', s: d.plr[0], e: d.plr[1], aa: postLayout },
		{ bc, sk: 'printing',           s: d.prn[0], e: d.prn[1], aa: ['prd'] },
		{ bc, sk: 'binding',            s: d.bnd[0], e: d.bnd[1], aa: ['bnd', 'prd'] },
		{ bc, sk: 'legal_deposit',      s: d.dep,    e: d.dep,    aa: ['prd'] },
	];

	const overallReviewer: Record<string, string> = { G9: 'rv1', G6: 'rv1', G4: 'rv1', G8: 'rv2', G7: 'rv2', G5: 'rv2', G3: 'rv3', G2: 'rv3', G1: 'rv3' };

	const taskDefs: TDef[] = [
		// ── Batch 1: G9, G8, G7 (image track) ─────────────────────────────────
		...['G9', 'G8', 'G7'].flatMap((bc, i) => [
			{ bc, sk: 'image_review',   s: '2026-10-01', e: '2026-10-02', st: 'done' as Status, aa: ['et1'] },
			{ bc, sk: 'overall_review', s: '2026-10-09', e: '2026-10-14', aa: [overallReviewer[bc]] },
			...tail(bc, i, { ind: ['2026-10-15', '2026-10-19'], plr: ['2026-10-20', '2026-10-21'], prn: ['2026-10-22', '2026-10-26'], bnd: ['2026-10-27', '2026-10-28'], dep: '2026-10-29' }),
		]),
		// ── Batch 2: G6, G5, G4 ─────────────────────────────────────────────────
		...['G6', 'G5', 'G4'].flatMap((bc, i) => [
			{ bc, sk: 'image_review',   s: '2026-10-05', e: '2026-10-08', st: 'in_progress' as Status, aa: ['rv1'] },
			{ bc, sk: 'overall_review', s: '2026-10-09', e: '2026-10-14', aa: [overallReviewer[bc]] },
			...tail(bc, i, { ind: ['2026-10-22', '2026-10-26'], plr: ['2026-10-27', '2026-10-28'], prn: ['2026-10-29', '2026-11-02'], bnd: ['2026-11-03', '2026-11-04'], dep: '2026-11-05' }),
		]),
		// ── Batch 3: G3, G2, G1 (image generation; review runs alongside it) ────
		// Rev 5 has the overall review on 13 to 19 Oct, 3 working days past the 9 to 14
		// window, beyond the 2-day allowance; it is seeded where the scheduler places it.
		...['G3', 'G2', 'G1'].flatMap((bc, i) => [
			{ bc, sk: 'image_generation', s: '2026-10-05', e: '2026-10-08', st: 'in_progress' as Status, aa: ['et1'] },
			{ bc, sk: 'image_review',     s: '2026-10-05', e: '2026-10-12', aa: ['rv3'], overflow: true },
			{ bc, sk: 'overall_review',   s: '2026-10-15', e: '2026-10-21', aa: [overallReviewer[bc]], overflow: true, rev5: ['2026-10-13', '2026-10-19'] as [string, string] },
			...tail(bc, i, { ind: ['2026-10-29', '2026-11-02'], plr: ['2026-11-03', '2026-11-04'], prn: ['2026-11-05', '2026-11-09'], bnd: ['2026-11-10', '2026-11-11'], dep: '2026-11-12' }),
		]),
		// ── Batch 4: KG2, KG1, N2 (content track; content and review run together) ─
		{ bc: 'KG2', sk: 'content_work', s: '2026-10-15', e: '2026-10-21', aa: ['et1', 'et2', 'et3', 'rv4'], overflow: true },
		{ bc: 'KG1', sk: 'content_work', s: '2026-10-22', e: '2026-10-28', aa: ['et1', 'rv4'], overflow: true },
		{ bc: 'N2',  sk: 'content_work', s: '2026-10-29', e: '2026-11-04', aa: ['et1', 'rv4'], overflow: true },
		...['KG2', 'KG1', 'N2'].flatMap((bc, i) =>
			tail(bc, i, { ind: ['2026-11-05', '2026-11-09'], plr: ['2026-11-10', '2026-11-11'], prn: ['2026-11-12', '2026-11-16'], bnd: ['2026-11-17', '2026-11-18'], dep: '2026-11-19' })
		),
		// ── Batch 5: N1 ─────────────────────────────────────────────────────────
		{ bc: 'N1', sk: 'content_work',          s: '2026-11-05', e: '2026-11-09', aa: ['et1'] },
		{ bc: 'N1', sk: 'content_images_review', s: '2026-11-10', e: '2026-11-11', aa: ['rv4'] },
		...tail('N1', 0, { ind: ['2026-11-12', '2026-11-16'], plr: ['2026-11-17', '2026-11-18'], prn: ['2026-11-19', '2026-11-20'], bnd: ['2026-11-23', '2026-11-24'], dep: '2026-11-25' }),
	];

	// Each book's tasks run in this order; every task depends on the one before it.
	// Batch 3's image generation feeds the overall review, because image review runs alongside it.
	const ORDER = [
		'image_review', 'overall_review', 'content_work', 'content_images_review',
		'indesign', 'post_layout_review', 'printing', 'binding', 'legal_deposit',
	];

	const rules: WindowRules = { enforce: true, windows: WINDOWS, overflowDays: OVERFLOW_DAYS };
	const taskRows: (typeof tasks.$inferInsert)[] = [];
	const assigneeRows: (typeof taskAssignees.$inferInsert)[] = [];
	const taskId: Record<string, string> = {};
	const problems: string[] = [];

	for (const td of taskDefs) {
		const id = ulid();
		taskId[`${td.bc}:${td.sk}`] = id;
		const durationDays = workingDays(td.s, td.e);
		const check = checkExplicitMove(
			{ id, startDate: td.s, endDate: td.e, durationDays, status: 'not_started', windowId: null, overflowAllowed: !!td.overflow, version: 1 },
			rules
		);
		if (!check.ok) problems.push(`${td.bc} ${stageName[td.sk]} (${td.s} to ${td.e}) ${check.reason}`);

		taskRows.push({
			id,
			bookId: BK[td.bc],
			stageId: ST[td.sk],
			windowId: check.ok ? check.windowId : null,
			scheduleState: 'scheduled',
			overflowAllowed: td.overflow ? 1 : 0,
			title: stageName[td.sk],
			startDate: td.s,
			endDate: td.e,
			durationDays,
			status: td.st ?? 'not_started',
			completedAt: td.st === 'done' ? NOW : null,
			createdAt: NOW,
			updatedAt: NOW,
		});
		td.aa.forEach((a, i) => assigneeRows.push({ taskId: id, personId: P[a], isLead: i === 0 ? 1 : 0 }));
	}

	const depRows: (typeof dependencies.$inferInsert)[] = [];
	for (const bc of Object.keys(BK)) {
		const chain = ORDER.filter((sk) => taskId[`${bc}:${sk}`]);
		for (let i = 1; i < chain.length; i++)
			depRows.push({ id: ulid(), predecessorId: taskId[`${bc}:${chain[i - 1]}`], successorId: taskId[`${bc}:${chain[i]}`], lagDays: 0 });
		if (taskId[`${bc}:image_generation`] && taskId[`${bc}:overall_review`])
			depRows.push({ id: ulid(), predecessorId: taskId[`${bc}:image_generation`], successorId: taskId[`${bc}:overall_review`], lagDays: 0 });
	}

	await db.insert(tasks).values(taskRows);
	await db.insert(taskAssignees).values(assigneeRows);
	await db.insert(dependencies).values(depRows);

	// ── Baseline – Rev 5 ───────────────────────────────────────────────────────

	const baselineId = ulid();
	await db.insert(baselines).values({
		id: baselineId,
		seriesId: SERIES,
		name: 'Rev 5',
		createdAt: NOW,
	});
	await db.insert(baselineTasks).values(
		taskDefs.map((td) => ({
			baselineId,
			taskId: taskId[`${td.bc}:${td.sk}`],
			startDate: td.rev5?.[0] ?? td.s,
			endDate: td.rev5?.[1] ?? td.e,
		}))
	);

	// ── Activity log ───────────────────────────────────────────────────────────

	await db.insert(activityLog).values({
		id: ulid(),
		seriesId: SERIES,
		actorId: P.et1,
		entity: 'series',
		entityId: SERIES,
		action: 'created',
		afterJson: JSON.stringify({ name: 'eSTEAM L2', startDate: '2026-10-01' }),
		createdAt: NOW,
	});

	console.log(`Done. Series: ${SERIES} | Tasks: ${taskRows.length} | Dependencies: ${depRows.length} | Windows: ${WINDOWS.length}`);
	if (problems.length) {
		console.warn(`\n${problems.length} Rev 5 task(s) do not fit their window, even with the ${OVERFLOW_DAYS}-day overflow allowance:`);
		for (const p of problems) console.warn(`  - ${p}`);
		console.warn('They are seeded without a window; the next window change or rule change will re-place them.');
	}
}

main().catch((e) => { console.error(e); process.exit(1); });
