/**
 * Templates and new series (spec: Template, POST /api/series, POST /api/series/:id/template).
 * A template is saved from a series' live pipeline; a new series copies a template's tracks,
 * stages, dependency pattern, team labels and settings, or starts from a blank pipeline.
 */
import { error } from '@sveltejs/kit';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { ulid } from 'ulid';
import { db } from '#lib/server/db/index.ts';
import { activityLog, people, series, seriesMembers, stageLinks, stages, stageTracks, templates, tracks } from '#lib/server/db/schema.ts';
import { BLANK, definitionFrom, definitionSchema, summary, type Definition } from '#lib/templates/definition.ts';

/** The series' pipeline as a definition: its live stages, links, team labels and settings. */
export async function snapshotSeries(seriesId: string): Promise<Definition> {
	const ser = await db.select().from(series).where(eq(series.id, seriesId)).then((r) => r[0]);
	if (!ser) throw error(404, 'Series not found');
	const [trackRows, stageRows, members] = await Promise.all([
		db.select().from(tracks).where(eq(tracks.seriesId, seriesId)),
		db.select().from(stages).where(eq(stages.seriesId, seriesId)),
		db.select({ teamLabel: seriesMembers.teamLabel }).from(seriesMembers).where(eq(seriesMembers.seriesId, seriesId)),
	]);
	const stageIds = stageRows.map((s) => s.id);
	const [links, st] = stageIds.length
		? await Promise.all([
			db.select().from(stageLinks).where(inArray(stageLinks.fromStageId, stageIds)),
			db.select().from(stageTracks).where(inArray(stageTracks.stageId, stageIds)),
		])
		: [[], []];
	return definitionFrom({
		tracks: trackRows, stages: stageRows, stageTracks: st, links,
		teamLabels: [...seriesLabels(ser.teamLabels), ...members.map((m) => m.teamLabel ?? '')],
		settings: ser,
	});
}

/** A series' own suggested team labels (stored as JSON). */
export function seriesLabels(json: string | null): string[] {
	try {
		const v = JSON.parse(json ?? '[]');
		return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
	} catch {
		return [];
	}
}

export async function saveTemplate(opts: { seriesId: string; name: string; description: string | null; actorId: string }) {
	const name = opts.name.trim();
	const taken = await db.select({ id: templates.id }).from(templates).where(eq(templates.name, name)).then((r) => r.length > 0);
	if (taken) throw error(422, `A template called ${name} already exists.`);
	const definition = await snapshotSeries(opts.seriesId);
	if (!definition.stages.length) throw error(422, 'This series has no stages yet, so there is nothing to save.');
	const now = new Date().toISOString();
	const row = { id: ulid(), name, description: opts.description?.trim() || null, definitionJson: JSON.stringify(definition), createdBy: opts.actorId, createdAt: now };
	await db.transaction(async (tx) => {
		await tx.insert(templates).values(row);
		await tx.insert(activityLog).values({
			id: ulid(), seriesId: opts.seriesId, actorId: opts.actorId, entity: 'template', entityId: row.id, action: 'create',
			afterJson: JSON.stringify({ name, description: row.description, ...summary(definition) }), createdAt: now,
		});
	});
	return { id: row.id, name, ...summary(definition) };
}

export function parseDefinition(json: string): Definition {
	const parsed = definitionSchema.safeParse(JSON.parse(json));
	if (!parsed.success) throw error(422, `This template cannot be used: ${parsed.error.issues[0].message}`);
	return parsed.data;
}

export async function listTemplates() {
	const rows = await db.select({ t: templates, by: people.displayName }).from(templates)
		.leftJoin(people, eq(people.id, templates.createdBy)).orderBy(desc(templates.createdAt));
	const usedBy = await db.select({ templateId: series.templateId, name: series.name }).from(series);
	return rows.map(({ t, by }) => {
		let definition: Definition | null = null;
		try { definition = definitionSchema.parse(JSON.parse(t.definitionJson)); } catch { /* shown as unusable */ }
		return {
			id: t.id, name: t.name, description: t.description, createdAt: t.createdAt, createdBy: by,
			definition, usable: !!definition, usedBy: usedBy.filter((s) => s.templateId === t.id).map((s) => s.name),
		};
	});
}

export async function updateTemplate(id: string, patch: { name?: string; description?: string | null }, actorId: string) {
	const before = await db.select().from(templates).where(eq(templates.id, id)).then((r) => r[0]);
	if (!before) throw error(404, 'Template not found');
	const name = patch.name?.trim();
	if (name && name !== before.name) {
		const taken = await db.select({ id: templates.id }).from(templates).where(eq(templates.name, name)).then((r) => r.length > 0);
		if (taken) throw error(422, `A template called ${name} already exists.`);
	}
	const set = { name: name ?? before.name, description: patch.description === undefined ? before.description : patch.description?.trim() || null };
	const now = new Date().toISOString();
	await db.transaction(async (tx) => {
		await tx.update(templates).set(set).where(eq(templates.id, id));
		await tx.insert(activityLog).values({
			id: ulid(), seriesId: null, actorId, entity: 'template', entityId: id, action: 'update',
			beforeJson: JSON.stringify({ name: before.name, description: before.description }), afterJson: JSON.stringify(set), createdAt: now,
		});
	});
	return { id, ...set };
}

/** Deleting a template leaves series made from it untouched: they own copies of its pipeline. */
export async function deleteTemplate(id: string, actorId: string) {
	const before = await db.select().from(templates).where(eq(templates.id, id)).then((r) => r[0]);
	if (!before) throw error(404, 'Template not found');
	const now = new Date().toISOString();
	await db.transaction(async (tx) => {
		await tx.update(series).set({ templateId: null }).where(eq(series.templateId, id));
		await tx.delete(templates).where(eq(templates.id, id));
		await tx.insert(activityLog).values({
			id: ulid(), seriesId: null, actorId, entity: 'template', entityId: id, action: 'delete',
			beforeJson: JSON.stringify(before), createdAt: now,
		});
	});
}

export type NewSeries = { name: string; startDate: string; targetDate: string; hardLimitDate?: string | null; templateId?: string | null; status?: 'planning' | 'active' };

/** Create a series from a template (or blank), with its tracks, stages, pattern, labels and settings. */
export async function createSeries(input: NewSeries, actorId: string) {
	const name = input.name.trim();
	const taken = await db.select({ id: series.id }).from(series).where(eq(series.name, name)).then((r) => r.length > 0);
	if (taken) throw error(422, `A series called ${name} already exists.`);
	let def = BLANK;
	if (input.templateId) {
		const t = await db.select().from(templates).where(eq(templates.id, input.templateId)).then((r) => r[0]);
		if (!t) throw error(422, 'That template no longer exists.');
		def = parseDefinition(t.definitionJson);
	}

	const seriesId = ulid();
	const now = new Date().toISOString();
	const trackId = new Map(def.tracks.map((t) => [t.key, ulid()]));
	const stageId = new Map(def.stages.map((s) => [s.key, ulid()]));
	const s = def.settings;

	await db.transaction(async (tx) => {
		await tx.insert(series).values({
			id: seriesId, name, templateId: input.templateId ?? null, status: input.status ?? 'planning',
			startDate: input.startDate, targetDate: input.targetDate, hardLimitDate: input.hardLimitDate || null,
			bookGroupLabel: s.bookGroupLabel, enforceWindows: +s.enforceWindows, strictMode: +s.strictMode,
			defaultCopies: s.defaultCopies, legalDepositCopies: s.legalDepositCopies, printBufferDays: s.printBufferDays,
			windowOverflowDays: s.windowOverflowDays, teamLabels: JSON.stringify(def.teamLabels),
		});
		if (def.tracks.length)
			await tx.insert(tracks).values(def.tracks.map((t, i) => ({ id: trackId.get(t.key)!, seriesId, key: t.key, name: t.name, sortOrder: i + 1 })));
		if (def.stages.length) {
			await tx.insert(stages).values(def.stages.map((st, i) => ({
				id: stageId.get(st.key)!, seriesId, key: st.key, name: st.name, category: st.category, sortOrder: i + 1,
				defaultDays: st.defaultDays, isReview: +st.isReview, isExternal: +st.isExternal, ignoresWindows: +st.ignoresWindows,
				deadlineRule: st.deadlineRule,
			})));
			const st = def.stages.flatMap((x) => x.trackKeys.map((k) => ({ stageId: stageId.get(x.key)!, trackId: trackId.get(k)! })));
			if (st.length) await tx.insert(stageTracks).values(st);
		}
		if (def.links.length)
			await tx.insert(stageLinks).values(def.links.map((l) => ({ fromStageId: stageId.get(l.from)!, toStageId: stageId.get(l.to)!, lagDays: l.lagDays })));
		await tx.insert(activityLog).values({
			id: ulid(), seriesId, actorId, entity: 'series', entityId: seriesId, action: 'created',
			afterJson: JSON.stringify({ name, startDate: input.startDate, targetDate: input.targetDate, templateId: input.templateId ?? null, ...summary(def) }),
			createdAt: now,
		});
	});
	return { id: seriesId, name, ...summary(def) };
}

/** Series the person can open: every series for an admin, otherwise those they belong to. */
export async function visibleSeries(personId: string | null, isAdmin: boolean) {
	if (isAdmin) return db.select({ id: series.id, name: series.name, status: series.status }).from(series).orderBy(asc(series.name));
	if (!personId) return [];
	return db.select({ id: series.id, name: series.name, status: series.status }).from(series)
		.innerJoin(seriesMembers, eq(seriesMembers.seriesId, series.id))
		.where(eq(seriesMembers.personId, personId)).orderBy(asc(series.name));
}
