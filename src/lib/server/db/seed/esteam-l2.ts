// Run: npm run db:seed
import { readFileSync } from 'node:fs';

// Load .env before any other code runs
try {
	for (const line of readFileSync('.env', 'utf8').split('\n')) {
		const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)/);
		if (m) (process.env as Record<string, string>)[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
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
	baselines,
	baselineTasks,
	activityLog,
} from '../schema.ts';

const client = createClient({ url: process.env.DATABASE_URL! });
const db = drizzle(client);
const NOW = new Date().toISOString();

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

const WN = { w1: ulid(), w2: ulid(), w3: ulid(), w4: ulid(), w5: ulid() };

const P: Record<string, string> = Object.fromEntries(
	['et1','et2','et3','rv1','rv2','rv3','rv4','ds1','ds2','ds3','prd','bnd'].map((k) => [k, ulid()])
);

// ─── Seed ─────────────────────────────────────────────────────────────────────

async function main() {
	console.log('Seeding eSTEAM L2…');

	await db.insert(seriesTable).values({
		id: SERIES,
		name: 'eSTEAM L2',
		status: 'active',
		startDate: '2026-10-01',
		targetDate: '2026-11-24',
		hardLimitDate: '2026-12-15',
		bookGroupLabel: 'Group',
		enforceWindows: 1,
		strictMode: 0,
		defaultCopies: 20,
		legalDepositCopies: 2,
		printBufferDays: 1,
	});

	// ── Tracks ─────────────────────────────────────────────────────────────────

	await db.insert(tracks).values([
		{ id: TRK.img, seriesId: SERIES, key: 'image',   name: 'Image Track',   sortOrder: 1 },
		{ id: TRK.cnt, seriesId: SERIES, key: 'content', name: 'Content Track', sortOrder: 2 },
	]);

	// ── Stages ─────────────────────────────────────────────────────────────────

	type Cat = 'creation' | 'review' | 'layout' | 'publish' | 'gate' | 'production';
	type StageTuple = [string, string, Cat, number, number, number?, number?, number?];

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
		['manuscript_submission', 'Manuscript Submission', 'publish',    9,  1],
		['agency_review',         'Agency Review',         'review',     10, 5, 1, 1, 1],
		['isbn_issued',           'ISBN Issued',           'publish',    11, 1],
		['print_approval',        'Print Approval',        'gate',       12, 0],
		['printing',              'Printing',              'production', 13, 3, 0, 0, 1],
		['binding',               'Binding',               'production', 14, 2, 0, 0, 1],
		['legal_deposit',         'Legal Deposit',         'production', 15, 1],
	];

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
		{ id: BK.G9,  seriesId: SERIES, trackId: TRK.img, code: 'G9',  name: 'Grade 9',        groupLabel: 'JHS',           batch: 1, sortOrder: 1  },
		{ id: BK.G8,  seriesId: SERIES, trackId: TRK.img, code: 'G8',  name: 'Grade 8',        groupLabel: 'JHS',           batch: 1, sortOrder: 2  },
		{ id: BK.G7,  seriesId: SERIES, trackId: TRK.img, code: 'G7',  name: 'Grade 7',        groupLabel: 'JHS',           batch: 1, sortOrder: 3  },
		{ id: BK.G6,  seriesId: SERIES, trackId: TRK.img, code: 'G6',  name: 'Grade 6',        groupLabel: 'Upper Primary', batch: 2, sortOrder: 4  },
		{ id: BK.G5,  seriesId: SERIES, trackId: TRK.img, code: 'G5',  name: 'Grade 5',        groupLabel: 'Upper Primary', batch: 2, sortOrder: 5  },
		{ id: BK.G4,  seriesId: SERIES, trackId: TRK.img, code: 'G4',  name: 'Grade 4',        groupLabel: 'Upper Primary', batch: 2, sortOrder: 6  },
		{ id: BK.G3,  seriesId: SERIES, trackId: TRK.img, code: 'G3',  name: 'Grade 3',        groupLabel: 'Lower Primary', batch: 3, sortOrder: 7  },
		{ id: BK.G2,  seriesId: SERIES, trackId: TRK.img, code: 'G2',  name: 'Grade 2',        groupLabel: 'Lower Primary', batch: 3, sortOrder: 8  },
		{ id: BK.G1,  seriesId: SERIES, trackId: TRK.img, code: 'G1',  name: 'Grade 1',        groupLabel: 'Lower Primary', batch: 3, sortOrder: 9  },
		{ id: BK.KG2, seriesId: SERIES, trackId: TRK.cnt, code: 'KG2', name: 'Kindergarten 2', groupLabel: 'Preschool',     batch: 4, sortOrder: 10 },
		{ id: BK.KG1, seriesId: SERIES, trackId: TRK.cnt, code: 'KG1', name: 'Kindergarten 1', groupLabel: 'Preschool',     batch: 4, sortOrder: 11 },
		{ id: BK.N2,  seriesId: SERIES, trackId: TRK.cnt, code: 'N2',  name: 'Nursery 2',      groupLabel: 'Preschool',     batch: 4, sortOrder: 12 },
		{ id: BK.N1,  seriesId: SERIES, trackId: TRK.cnt, code: 'N1',  name: 'Nursery 1',      groupLabel: 'Preschool',     batch: 5, sortOrder: 13 },
	]);

	// ── Windows ─────────────────────────────────────────────────────────────────

	await db.insert(windowsTable).values([
		{ id: WN.w1, seriesId: SERIES, label: 'Sprint 1 – Image Review',        startDate: '2026-10-01', endDate: '2026-10-14', sortOrder: 1 },
		{ id: WN.w2, seriesId: SERIES, label: 'Sprint 2 – Layout Batch 1–2',   startDate: '2026-10-15', endDate: '2026-10-28', sortOrder: 2 },
		{ id: WN.w3, seriesId: SERIES, label: 'Sprint 3 – Production Batch 3', startDate: '2026-10-29', endDate: '2026-11-11', sortOrder: 3 },
		{ id: WN.w4, seriesId: SERIES, label: 'Sprint 4 – Content & Batch 4–5',startDate: '2026-11-12', endDate: '2026-11-24', sortOrder: 4 },
		{ id: WN.w5, seriesId: SERIES, label: 'Reserve',                        startDate: '2026-11-25', endDate: '2026-12-15', sortOrder: 5 },
	]);

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

	await db.insert(seriesMembers).values([
		{ seriesId: SERIES, personId: P.et1, role: 'coordinator', teamLabel: 'Editorial',  capacity: 1 },
		{ seriesId: SERIES, personId: P.et2, role: 'coordinator', teamLabel: 'Editorial',  capacity: 1 },
		{ seriesId: SERIES, personId: P.et3, role: 'coordinator', teamLabel: 'Editorial',  capacity: 1 },
		{ seriesId: SERIES, personId: P.rv1, role: 'contributor', teamLabel: 'Review',     capacity: 1 },
		{ seriesId: SERIES, personId: P.rv2, role: 'contributor', teamLabel: 'Review',     capacity: 1 },
		{ seriesId: SERIES, personId: P.rv3, role: 'contributor', teamLabel: 'Review',     capacity: 1 },
		{ seriesId: SERIES, personId: P.rv4, role: 'contributor', teamLabel: 'Review',     capacity: 1 },
		{ seriesId: SERIES, personId: P.ds1, role: 'contributor', teamLabel: 'Design',     capacity: 1 },
		{ seriesId: SERIES, personId: P.ds2, role: 'contributor', teamLabel: 'Design',     capacity: 1 },
		{ seriesId: SERIES, personId: P.ds3, role: 'contributor', teamLabel: 'Design',     capacity: 1 },
		{ seriesId: SERIES, personId: P.prd, role: 'contributor', teamLabel: 'Production', capacity: 1 },
		{ seriesId: SERIES, personId: P.bnd, role: 'contributor', teamLabel: 'External',   capacity: 1 },
	]);

	// ── Tasks ──────────────────────────────────────────────────────────────────
	// Today = 2026-10-05.
	// Batch 1 (G9-G7): image_review done (Oct 1-2). Rest not started.
	// Batch 2 (G6-G4): image_review in_progress (Oct 5-8).
	// Batch 3 (G3-G1): image_generation in_progress (Oct 5-9).
	// Batches 4-5: not started.

	type Status = 'not_started' | 'in_progress' | 'done';
	type TDef = {
		bc: string; sk: string; s: string; e: string; dur: number;
		st?: Status; wk?: keyof typeof WN; aa?: string[]; lead?: string;
	};

	const b1 = ['G9', 'G8', 'G7'];
	const b2 = ['G6', 'G5', 'G4'];
	const b3 = ['G3', 'G2', 'G1'];

	const taskDefs: TDef[] = [
		// ── Batch 1 – JHS (image track, no image_gen) ──────────────────────────
		...b1.flatMap((bc) => [
			{ bc, sk: 'image_review',       s: '2026-10-01', e: '2026-10-02', dur: 2, st: 'done' as Status,        wk: 'w1' as const, aa: ['rv1','rv2'], lead: 'rv1' },
			{ bc, sk: 'overall_review',     s: '2026-10-09', e: '2026-10-14', dur: 4, st: 'not_started' as Status, wk: 'w1' as const, aa: ['rv1','rv2'], lead: 'rv1' },
			{ bc, sk: 'indesign',           s: '2026-10-15', e: '2026-10-19', dur: 3, st: 'not_started' as Status, wk: 'w2' as const, aa: ['ds1'],       lead: 'ds1' },
			{ bc, sk: 'post_layout_review', s: '2026-10-20', e: '2026-10-21', dur: 2, st: 'not_started' as Status, wk: 'w2' as const, aa: ['et1'],       lead: 'et1' },
			{ bc, sk: 'printing',           s: '2026-10-22', e: '2026-10-26', dur: 3, st: 'not_started' as Status,                    aa: ['prd'],       lead: 'prd' },
			{ bc, sk: 'binding',            s: '2026-10-27', e: '2026-10-28', dur: 2, st: 'not_started' as Status,                    aa: ['bnd'],       lead: 'bnd' },
			{ bc, sk: 'legal_deposit',      s: '2026-10-29', e: '2026-10-29', dur: 1, st: 'not_started' as Status, wk: 'w2' as const, aa: ['prd'],       lead: 'prd' },
		]),
		// ── Batch 2 – Upper Primary ─────────────────────────────────────────────
		...b2.flatMap((bc) => [
			{ bc, sk: 'image_review',       s: '2026-10-05', e: '2026-10-08', dur: 4, st: 'in_progress' as Status, wk: 'w1' as const, aa: ['rv1','rv2'], lead: 'rv1' },
			{ bc, sk: 'overall_review',     s: '2026-10-09', e: '2026-10-14', dur: 4, st: 'not_started' as Status, wk: 'w1' as const, aa: ['rv1','rv2'], lead: 'rv1' },
			{ bc, sk: 'indesign',           s: '2026-10-22', e: '2026-10-26', dur: 3, st: 'not_started' as Status, wk: 'w2' as const, aa: ['ds2'],       lead: 'ds2' },
			{ bc, sk: 'post_layout_review', s: '2026-10-27', e: '2026-10-28', dur: 2, st: 'not_started' as Status, wk: 'w2' as const, aa: ['et1'],       lead: 'et1' },
			{ bc, sk: 'printing',           s: '2026-10-29', e: '2026-11-02', dur: 3, st: 'not_started' as Status,                    aa: ['prd'],       lead: 'prd' },
			{ bc, sk: 'binding',            s: '2026-11-03', e: '2026-11-04', dur: 2, st: 'not_started' as Status,                    aa: ['bnd'],       lead: 'bnd' },
			{ bc, sk: 'legal_deposit',      s: '2026-11-05', e: '2026-11-05', dur: 1, st: 'not_started' as Status, wk: 'w3' as const, aa: ['prd'],       lead: 'prd' },
		]),
		// ── Batch 3 – Lower Primary (has image_gen) ─────────────────────────────
		...b3.flatMap((bc) => [
			{ bc, sk: 'image_generation',   s: '2026-10-05', e: '2026-10-09', dur: 5, st: 'in_progress' as Status, wk: 'w1' as const, aa: ['ds3'],       lead: 'ds3' },
			{ bc, sk: 'image_review',       s: '2026-10-12', e: '2026-10-16', dur: 5, st: 'not_started' as Status, wk: 'w1' as const, aa: ['rv3','rv4'], lead: 'rv3' },
			{ bc, sk: 'overall_review',     s: '2026-10-19', e: '2026-10-23', dur: 5, st: 'not_started' as Status, wk: 'w2' as const, aa: ['rv3','rv4'], lead: 'rv3' },
			{ bc, sk: 'indesign',           s: '2026-10-29', e: '2026-11-02', dur: 3, st: 'not_started' as Status, wk: 'w3' as const, aa: ['ds3'],       lead: 'ds3' },
			{ bc, sk: 'post_layout_review', s: '2026-11-03', e: '2026-11-04', dur: 2, st: 'not_started' as Status, wk: 'w3' as const, aa: ['et2'],       lead: 'et2' },
			{ bc, sk: 'printing',           s: '2026-11-05', e: '2026-11-09', dur: 3, st: 'not_started' as Status,                    aa: ['prd'],       lead: 'prd' },
			{ bc, sk: 'binding',            s: '2026-11-10', e: '2026-11-11', dur: 2, st: 'not_started' as Status,                    aa: ['bnd'],       lead: 'bnd' },
			{ bc, sk: 'legal_deposit',      s: '2026-11-12', e: '2026-11-12', dur: 1, st: 'not_started' as Status, wk: 'w4' as const, aa: ['prd'],       lead: 'prd' },
		]),
		// ── Batch 4 – Preschool (content track, staggered content_work) ─────────
		{ bc: 'KG2', sk: 'content_work',      s: '2026-10-15', e: '2026-10-21', dur: 5, st: 'not_started', wk: 'w2', aa: ['et2'], lead: 'et2' },
		{ bc: 'KG1', sk: 'content_work',      s: '2026-10-22', e: '2026-10-28', dur: 5, st: 'not_started', wk: 'w2', aa: ['et2'], lead: 'et2' },
		{ bc: 'N2',  sk: 'content_work',      s: '2026-10-29', e: '2026-11-04', dur: 5, st: 'not_started', wk: 'w3', aa: ['et3'], lead: 'et3' },
		...['KG2','KG1','N2'].flatMap((bc) => [
			{ bc, sk: 'indesign',           s: '2026-11-05', e: '2026-11-09', dur: 3, st: 'not_started' as Status, wk: 'w4' as const, aa: ['ds1'], lead: 'ds1' },
			{ bc, sk: 'post_layout_review', s: '2026-11-10', e: '2026-11-11', dur: 2, st: 'not_started' as Status, wk: 'w4' as const, aa: ['et1'], lead: 'et1' },
			{ bc, sk: 'printing',           s: '2026-11-12', e: '2026-11-16', dur: 3, st: 'not_started' as Status,                    aa: ['prd'], lead: 'prd' },
			{ bc, sk: 'binding',            s: '2026-11-17', e: '2026-11-18', dur: 2, st: 'not_started' as Status,                    aa: ['bnd'], lead: 'bnd' },
			{ bc, sk: 'legal_deposit',      s: '2026-11-19', e: '2026-11-19', dur: 1, st: 'not_started' as Status, wk: 'w4' as const, aa: ['prd'], lead: 'prd' },
		]),
		// ── Batch 5 – N1 ─────────────────────────────────────────────────────────
		{ bc: 'N1', sk: 'content_work',      s: '2026-11-05', e: '2026-11-09', dur: 5, st: 'not_started', wk: 'w4', aa: ['et3'], lead: 'et3' },
		{ bc: 'N1', sk: 'indesign',          s: '2026-11-12', e: '2026-11-16', dur: 3, st: 'not_started', wk: 'w4', aa: ['ds2'], lead: 'ds2' },
		{ bc: 'N1', sk: 'post_layout_review',s: '2026-11-17', e: '2026-11-18', dur: 2, st: 'not_started', wk: 'w4', aa: ['et1'], lead: 'et1' },
		{ bc: 'N1', sk: 'printing',          s: '2026-11-19', e: '2026-11-20', dur: 2, st: 'not_started',            aa: ['prd'], lead: 'prd' },
		{ bc: 'N1', sk: 'binding',           s: '2026-11-23', e: '2026-11-24', dur: 2, st: 'not_started',            aa: ['bnd'], lead: 'bnd' },
		{ bc: 'N1', sk: 'legal_deposit',     s: '2026-11-25', e: '2026-11-25', dur: 1, st: 'not_started', wk: 'w5', aa: ['prd'], lead: 'prd' },
	];

	// Collect rows for batch insert
	const taskRows: (typeof tasks.$inferInsert)[] = [];
	const assigneeRows: (typeof taskAssignees.$inferInsert)[] = [];
	const taskIdMap: Record<string, string> = {};

	for (const td of taskDefs) {
		const taskId = ulid();
		taskIdMap[`${td.bc}:${td.sk}`] = taskId;
		const stageName = td.sk.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
		taskRows.push({
			id: taskId,
			bookId: BK[td.bc],
			stageId: ST[td.sk],
			windowId: td.wk ? WN[td.wk] : null,
			scheduleState: 'scheduled',
			title: `${td.bc} – ${stageName}`,
			startDate: td.s,
			endDate: td.e,
			durationDays: td.dur,
			status: td.st ?? 'not_started',
			completedAt: td.st === 'done' ? NOW : null,
			createdAt: NOW,
			updatedAt: NOW,
		});
		if (td.aa?.length) {
			for (const a of td.aa) {
				assigneeRows.push({ taskId, personId: P[a], isLead: a === td.lead ? 1 : 0 });
			}
		}
	}

	await db.insert(tasks).values(taskRows);
	await db.insert(taskAssignees).values(assigneeRows);

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
			taskId: taskIdMap[`${td.bc}:${td.sk}`],
			startDate: td.s,
			endDate: td.e,
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

	console.log(`Done. Series: ${SERIES} | Tasks: ${taskRows.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
