<script lang="ts">
	import { untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { api } from '#lib/api-client.ts';
	import { isWorkingDay, setHolidays } from '#lib/schedule/calendar.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	type Member = (typeof data.members)[number];
	type Flash = { ok: boolean; text: string } | null;

	const STATUS_LABEL: Record<string, string> = {
		active: 'Active', invited: 'Invited', placeholder: 'Placeholder', deactivated: 'Deactivated'
	};
	const ROLE_LABEL: Record<string, string> = { coordinator: 'Coordinator', contributor: 'Contributor', viewer: 'Viewer' };

	// ── General and print settings ───────────────────────────────────────────
	// Form copies of the saved values; resynced from the server after each save.
	const generalFromServer = () => ({
		name: data.series.name,
		status: data.series.status,
		targetDate: data.series.targetDate,
		hardLimitDate: data.series.hardLimitDate ?? '',
		bookGroupLabel: data.series.bookGroupLabel,
		enforceWindows: !!data.series.enforceWindows,
		windowOverflowDays: data.series.windowOverflowDays,
		strictMode: !!data.series.strictMode
	});
	const printFromServer = () => ({
		defaultCopies: data.series.defaultCopies,
		legalDepositCopies: data.series.legalDepositCopies,
		printBufferDays: data.series.printBufferDays
	});
	let general = $state(generalFromServer());
	let print = $state(printFromServer());
	let generalFlash = $state<Flash>(null);
	let printFlash = $state<Flash>(null);
	let busy = $state(false);

	// Save the pipeline as a template (spec: POST /api/series/:id/template).
	let tplName = $state('');
	let tplFlash = $state<{ ok: boolean; text: string } | null>(null);
	async function saveAsTemplate(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		const res = await api<{ name: string; stages: number }>('POST', `/api/series/${data.series.id}/template`, { name: tplName });
		busy = false;
		tplFlash = res.ok
			? { ok: true, text: `Saved ${res.data.name} (${res.data.stages} stages). ${data.isAdmin ? 'Find it under Templates.' : 'An admin can start new series from it.'}` }
			: { ok: false, text: res.message };
		if (res.ok) tplName = '';
	}

	const generalDirty = $derived(
		general.name !== data.series.name ||
			general.status !== data.series.status ||
			general.targetDate !== data.series.targetDate ||
			(general.hardLimitDate || null) !== data.series.hardLimitDate ||
			general.bookGroupLabel !== data.series.bookGroupLabel ||
			general.enforceWindows !== !!data.series.enforceWindows ||
			general.windowOverflowDays !== data.series.windowOverflowDays ||
			general.strictMode !== !!data.series.strictMode
	);
	const printDirty = $derived(
		print.defaultCopies !== data.series.defaultCopies ||
			print.legalDepositCopies !== data.series.legalDepositCopies ||
			print.printBufferDays !== data.series.printBufferDays
	);

	async function save(body: Record<string, unknown>, set: (f: Flash) => void, resync: () => void) {
		busy = true;
		const res = await api<SaveResult>('PATCH', `/api/series/${data.series.id}`, body);
		busy = false;
		set(res.ok ? { ok: true, text: 'Saved.' } : { ok: false, text: res.message });
		if (res.ok) {
			await invalidateAll();
			resync();
		}
		return res;
	}

	// Changing window rules can move tasks: preview the impact, then confirm (spec: Changing windows).
	type Report = {
		moved: number;
		unscheduled: number;
		placed: number;
		rewindowed: number;
		outsideWindow: { id: string; label: string }[];
		projectedFinish: { before: string | null; after: string | null };
		changes: {
			id: string;
			label: string;
			kind: string;
			from: { startDate: string; window: string | null };
			to: { startDate: string; window: string | null };
		}[];
	};
	type SaveResult = { report: Report | null; batchId?: string };
	let pending = $state<{ body: Record<string, unknown>; report: Report } | null>(null);
	let lastBatch = $state<string | null>(null);

	const impactful = (r: Report | null): r is Report =>
		!!r && r.moved + r.unscheduled + r.placed + r.rewindowed + r.outsideWindow.length > 0;
	const sameImpact = (a: Report, b: Report) =>
		a.moved === b.moved && a.unscheduled === b.unscheduled && a.placed === b.placed &&
		a.outsideWindow.length === b.outsideWindow.length && a.projectedFinish.after === b.projectedFinish.after;
	const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

	function summary(r: Report) {
		const parts: string[] = [];
		if (r.moved) parts.push(plural(r.moved, 'task moves', 'tasks move'));
		if (r.unscheduled) parts.push(plural(r.unscheduled, 'becomes unscheduled', 'become unscheduled'));
		if (r.placed) parts.push(plural(r.placed, 'unscheduled task is placed', 'unscheduled tasks are placed'));
		if (r.rewindowed) parts.push(plural(r.rewindowed, 'task changes window', 'tasks change window'));
		if (r.outsideWindow.length)
			parts.push(plural(r.outsideWindow.length, 'started task is flagged Outside window', 'started tasks are flagged Outside window'));
		if (r.projectedFinish.after && r.projectedFinish.after !== r.projectedFinish.before)
			parts.push(`projected finish ${fmtDate(r.projectedFinish.after)}`);
		return parts.join(', ');
	}

	async function saveGeneral(e: SubmitEvent) {
		e.preventDefault();
		const body = { ...general, hardLimitDate: general.hardLimitDate || null };
		const rulesChanged =
			general.enforceWindows !== !!data.series.enforceWindows ||
			general.windowOverflowDays !== data.series.windowOverflowDays;
		if (rulesChanged) {
			busy = true;
			const res = await api<SaveResult>('PATCH', `/api/series/${data.series.id}`, { ...body, preview: true });
			busy = false;
			if (!res.ok) return (generalFlash = { ok: false, text: res.message });
			if (impactful(res.data.report)) return (pending = { body, report: res.data.report });
		}
		await commitGeneral(body, null);
	}

	async function commitGeneral(body: Record<string, unknown>, previewed: Report | null) {
		pending = null;
		const res = await save(body, (f) => (generalFlash = f), () => (general = generalFromServer()));
		if (!res.ok) return;
		const applied = res.data.report;
		lastBatch = impactful(applied) ? (res.data.batchId ?? null) : null;
		if (!impactful(applied)) return;
		generalFlash = {
			ok: true,
			text: previewed && !sameImpact(previewed, applied)
				? `Saved, but the schedule changed after the preview. Applied: ${summary(applied)}.`
				: `Saved. ${summary(applied)}.`
		};
	}

	async function undoLast() {
		if (!lastBatch) return;
		busy = true;
		const res = await api('POST', '/api/undo', { batchId: lastBatch, seriesId: data.series.id });
		busy = false;
		lastBatch = null;
		generalFlash = res.ok ? { ok: true, text: 'Undone.' } : { ok: false, text: res.message };
		if (res.ok) {
			await invalidateAll();
			general = generalFromServer();
		}
	}
	function savePrint(e: SubmitEvent) {
		e.preventDefault();
		save({ ...print }, (f) => (printFlash = f), () => (print = printFromServer()));
	}

	// "Apply to all books": the series defaults into every print record whose printing has not started.
	type ApplyReport = {
		defaults: { copiesPlanned: number; depositCopies: number };
		updated: { code: string }[]; skipped: { code: string; reason: string }[]; unchanged: string[];
		batchId?: string;
	};
	let applyPreview = $state<ApplyReport | null>(null);
	let lastApplyBatch = $state<string | null>(null);
	const applyBody = { fields: ['copiesPlanned', 'depositCopies'] };

	async function previewApply() {
		busy = true;
		printFlash = null;
		const res = await api<ApplyReport>('POST', `/api/series/${data.series.id}/print-defaults/apply`, { ...applyBody, preview: true });
		busy = false;
		if (!res.ok) return (printFlash = { ok: false, text: res.message });
		applyPreview = res.data;
	}
	async function confirmApply() {
		busy = true;
		const res = await api<ApplyReport>('POST', `/api/series/${data.series.id}/print-defaults/apply`, applyBody);
		busy = false;
		applyPreview = null;
		if (!res.ok) return (printFlash = { ok: false, text: res.message });
		lastApplyBatch = res.data.updated.length ? (res.data.batchId ?? null) : null;
		printFlash = {
			ok: true,
			text: `Updated ${plural(res.data.updated.length, 'book', 'books')}${res.data.skipped.length ? `; skipped ${res.data.skipped.map((s) => s.code).join(', ')} (printing has started)` : ''}.`
		};
	}
	async function undoApply() {
		if (!lastApplyBatch) return;
		busy = true;
		const res = await api('POST', '/api/undo', { batchId: lastApplyBatch, seriesId: data.series.id });
		busy = false;
		lastApplyBatch = null;
		printFlash = res.ok ? { ok: true, text: 'Undone.' } : { ok: false, text: res.message };
	}

	// ── Windows ─────────────────────────────────────────────────────────────
	// Every change is previewed first when windows are enforced, since it can move tasks.
	type WinCall = { method: string; url: string; body: Record<string, unknown>; okText: string };
	let winPending = $state<(WinCall & { report: Report }) | null>(null);
	let winFlash = $state<Flash>(null);
	let lastWinBatch = $state<string | null>(null);
	let editingWin = $state<{ id: string; label: string; startDate: string; endDate: string } | null>(null);
	let newWin = $state({ label: '', startDate: '', endDate: '' });

	const DAY_MS = 86_400_000;
	// Same calendar as the server: holidays are not working days.
	setHolidays(untrack(() => data.holidays));
	function workingDays(start: string, end: string) {
		const from = Date.parse(start + 'T12:00:00Z');
		const to = Date.parse(end + 'T12:00:00Z');
		let n = 0;
		for (let t = from; t <= to; t += DAY_MS) if (isWorkingDay(new Date(t).toISOString().slice(0, 10))) n++;
		return n;
	}

	async function windowCall(call: WinCall) {
		winFlash = null;
		if (data.series.enforceWindows) {
			busy = true;
			const res = await api<SaveResult>(call.method, call.url, { ...call.body, preview: true });
			busy = false;
			if (!res.ok) return (winFlash = { ok: false, text: res.message });
			if (impactful(res.data.report)) return (winPending = { ...call, report: res.data.report });
		}
		await commitWindow(call, null);
	}

	async function commitWindow(call: WinCall, previewed: Report | null) {
		winPending = null;
		busy = true;
		const res = await api<SaveResult>(call.method, call.url, call.body);
		busy = false;
		if (!res.ok) return (winFlash = { ok: false, text: res.message });
		editingWin = null;
		const applied = res.data.report;
		lastWinBatch = res.data.batchId ?? null;
		winFlash = {
			ok: true,
			text: !impactful(applied) ? call.okText
				: previewed && !sameImpact(previewed, applied)
					? `${call.okText} The schedule changed after the preview. Applied: ${summary(applied)}.`
					: `${call.okText} ${summary(applied)}.`
		};
		await invalidateAll();
	}

	async function undoWindow() {
		if (!lastWinBatch) return;
		busy = true;
		const res = await api('POST', '/api/undo', { batchId: lastWinBatch, seriesId: data.series.id });
		busy = false;
		lastWinBatch = null;
		winFlash = res.ok ? { ok: true, text: 'Undone.' } : { ok: false, text: res.message };
		if (res.ok) await invalidateAll();
	}

	function addWindow(e: SubmitEvent) {
		e.preventDefault();
		windowCall({ method: 'POST', url: `/api/series/${data.series.id}/windows`, body: { ...newWin, label: newWin.label.trim() }, okText: `Added "${newWin.label.trim()}".` })
			.then(() => { if (winFlash?.ok) newWin = { label: '', startDate: '', endDate: '' }; });
	}

	function saveWindow(e: SubmitEvent) {
		e.preventDefault();
		if (!editingWin) return;
		const { id, ...fields } = editingWin;
		windowCall({ method: 'PATCH', url: `/api/windows/${id}`, body: { ...fields, label: fields.label.trim() }, okText: 'Window updated.' });
	}

	// ── Pipeline (edits only: nothing here creates or deletes tasks) ─────────
	type PStage = (typeof data.pipeline.stages)[number];
	type PBook = (typeof data.pipeline.books)[number];
	type DueChange = { id: string; label: string; from: string | null; to: string | null };
	type StageResult = { report: Report | null; dueDates: DueChange[]; batchId?: string };

	const CATEGORIES = ['creation', 'review', 'layout', 'publish', 'gate', 'production'] as const;
	const CATEGORY_LABEL: Record<string, string> = {
		creation: 'Creation', review: 'Review', layout: 'Layout', publish: 'Publishing', gate: 'Gate', production: 'Production'
	};

	let pipeFlash = $state<Flash>(null);
	let lastPipeBatch = $state<string | null>(null);

	// Track rename
	let renamingTrack = $state<{ id: string; name: string } | null>(null);
	async function renameTrack(e: SubmitEvent) {
		e.preventDefault();
		if (!renamingTrack) return;
		const res = await pipeCall('PATCH', `/api/tracks/${renamingTrack.id}`, { name: renamingTrack.name.trim() }, 'Track renamed.');
		if (res) renamingTrack = null;
	}

	// Stage drafts: one per stage, edited inline and saved per row.
	type StageDraft = {
		name: string; category: string; defaultDays: number; isReview: boolean; isExternal: boolean;
		ignoresWindows: boolean; deadlineAfter: string; deadlineMonths: number; deadlineDays: number;
	};
	function stageDraft(s: PStage): StageDraft {
		let rule: { after?: string; months?: number; days?: number } = {};
		try { rule = s.deadlineRule ? JSON.parse(s.deadlineRule) : {}; } catch { /* malformed rule: treat as none */ }
		return {
			name: s.name, category: s.category, defaultDays: s.defaultDays, isReview: !!s.isReview, isExternal: !!s.isExternal,
			ignoresWindows: !!s.ignoresWindows, deadlineAfter: rule.after ?? '', deadlineMonths: rule.months ?? 0, deadlineDays: rule.days ?? 0
		};
	}
	const sameDraft = (a: object, b: object) => JSON.stringify(a) === JSON.stringify(b);

	const bookDraft = (b: PBook) => ({ code: b.code, name: b.name, groupLabel: b.groupLabel ?? '', batch: b.batch });
	// Built immediately so the tables also render on the server, not only after hydration.
	const initialStageDrafts = () => Object.fromEntries(data.pipeline.stages.map((s) => [s.id, stageDraft(s)]));
	const initialBookDrafts = () => Object.fromEntries(data.pipeline.books.map((b) => [b.id, bookDraft(b)]));
	let stageDrafts = $state<Record<string, StageDraft>>(initialStageDrafts());
	let bookDrafts = $state<Record<string, ReturnType<typeof bookDraft>>>(initialBookDrafts());
	// Fresh drafts when the server data changes, keeping rows with unsaved edits (as in Team).
	const syncedStages: Record<string, StageDraft> = {};
	const syncedBooks: Record<string, ReturnType<typeof bookDraft>> = {};
	function merge<T extends object>(current: Record<string, T>, synced: Record<string, T>, fresh: [string, T][]) {
		const next: Record<string, T> = {};
		for (const [id, f] of fresh) {
			const prev = current[id];
			const old = synced[id];
			next[id] = !prev || !old || sameDraft(prev, old) ? f : prev;
			synced[id] = f;
		}
		return next;
	}
	$effect(() => {
		const stagesFresh = data.pipeline.stages.map((s): [string, StageDraft] => [s.id, stageDraft(s)]);
		const booksFresh = data.pipeline.books.map((b): [string, ReturnType<typeof bookDraft>] => [b.id, bookDraft(b)]);
		untrack(() => {
			stageDrafts = merge(stageDrafts, syncedStages, stagesFresh);
			bookDrafts = merge(bookDrafts, syncedBooks, booksFresh);
		});
	});
	const stageDirty = (s: PStage) => !!stageDrafts[s.id] && !sameDraft(stageDrafts[s.id], stageDraft(s));
	const bookDirty = (b: PBook) => !!bookDrafts[b.id] && !sameDraft(bookDrafts[b.id], bookDraft(b));
	const groupLabels = $derived([...new Set(data.pipeline.books.map((b) => b.groupLabel).filter((g): g is string => !!g))].sort());

	async function pipeCall(method: string, url: string, body: unknown, okText: string) {
		busy = true;
		pipeFlash = null;
		const res = await api<StageResult>(method, url, body);
		busy = false;
		if (!res.ok) {
			pipeFlash = { ok: false, text: res.message };
			return null;
		}
		pipeFlash = { ok: true, text: okText };
		await invalidateAll();
		return res.data;
	}

	function stageBody(s: PStage) {
		const d = stageDrafts[s.id];
		const rule = d.deadlineAfter
			? { after: d.deadlineAfter, ...(d.deadlineMonths ? { months: Number(d.deadlineMonths) } : {}), ...(d.deadlineDays ? { days: Number(d.deadlineDays) } : {}) }
			: null;
		return {
			name: d.name.trim(), category: d.category, defaultDays: Number(d.defaultDays), isReview: d.isReview,
			isExternal: d.isExternal, ignoresWindows: d.ignoresWindows, deadlineRule: rule
		};
	}

	// Window exemption and deadline changes can move tasks or due dates: preview first.
	let stagePending = $state<{ stage: PStage; body: ReturnType<typeof stageBody>; result: StageResult } | null>(null);

	async function saveStage(s: PStage) {
		const body = stageBody(s);
		const orig = stageDraft(s);
		const draft = stageDrafts[s.id];
		const risky = draft.ignoresWindows !== orig.ignoresWindows || draft.deadlineAfter !== orig.deadlineAfter ||
			draft.deadlineMonths !== orig.deadlineMonths || draft.deadlineDays !== orig.deadlineDays;
		if (risky) {
			busy = true;
			const res = await api<StageResult>('PATCH', `/api/stages/${s.id}`, { ...body, preview: true });
			busy = false;
			if (!res.ok) return (pipeFlash = { ok: false, text: res.message });
			if (impactful(res.data.report) || res.data.dueDates.length) return (stagePending = { stage: s, body, result: res.data });
		}
		await commitStage(s, body);
	}

	async function commitStage(s: PStage, body: ReturnType<typeof stageBody>) {
		stagePending = null;
		const result = await pipeCall('PATCH', `/api/stages/${s.id}`, body, `Saved ${body.name}.`);
		if (!result) return;
		lastPipeBatch = result.batchId ?? null;
		const parts = [impactful(result.report) ? summary(result.report) : '', result.dueDates.length ? plural(result.dueDates.length, 'due date updated', 'due dates updated') : '']
			.filter(Boolean);
		if (parts.length) pipeFlash = { ok: true, text: `Saved ${body.name}. ${parts.join(', ')}.` };
	}

	async function undoPipe() {
		if (!lastPipeBatch) return;
		busy = true;
		const res = await api('POST', '/api/undo', { batchId: lastPipeBatch, seriesId: data.series.id });
		busy = false;
		lastPipeBatch = null;
		pipeFlash = res.ok ? { ok: true, text: 'Undone.' } : { ok: false, text: res.message };
		if (res.ok) await invalidateAll();
	}

	function saveBook(b: PBook) {
		const d = bookDrafts[b.id];
		pipeCall('PATCH', `/api/books/${b.id}`, {
			code: d.code.trim(), name: d.name.trim(), groupLabel: d.groupLabel.trim() || null,
			batch: d.batch === null || (d.batch as unknown) === '' ? null : Number(d.batch)
		}, `Saved ${d.code.trim()}.`);
	}

	/** Move one item up or down and save the whole order. */
	function move(kind: 'track' | 'stage' | 'book', list: { id: string }[], index: number, by: -1 | 1) {
		const ids = list.map((x) => x.id);
		const to = index + by;
		if (to < 0 || to >= ids.length) return;
		[ids[index], ids[to]] = [ids[to], ids[index]];
		pipeCall('PUT', `/api/series/${data.series.id}/${kind}-order`, { ids }, 'Order saved.');
	}

	const stageName = $derived(new Map(data.pipeline.stages.map((s) => [s.id, s.name])));

	// Tracks: add one from existing stages, or delete one no book follows.
	let newTrack = $state({ name: '', include: {} as Record<string, boolean> });
	async function addTrack(e: SubmitEvent) {
		e.preventDefault();
		const name = newTrack.name.trim();
		const stageIds = data.pipeline.stages.filter((s) => newTrack.include[s.id]).map((s) => s.id);
		const result = await pipeCall('POST', `/api/series/${data.series.id}/tracks`, { name, stageIds }, `Added ${name}.`);
		if (!result) return;
		lastPipeBatch = (result as unknown as { batchId?: string }).batchId ?? null;
		newTrack = { name: '', include: {} };
	}
	async function deleteTrack(id: string, name: string) {
		const result = await pipeCall('DELETE', `/api/tracks/${id}`, undefined, `Deleted ${name}.`);
		if (result) lastPipeBatch = (result as unknown as { batchId?: string }).batchId ?? null;
	}

	// Add a stage: where it joins the pattern, which tracks and books get it.
	type GrowPreview = {
		tasks: { book: string; stage: string; startDate: string; endDate: string; window: string | null; scheduleState: string }[];
		linked: number; unlinked: number;
		pushed: { label: string; from: string; to: string; scheduleState: string }[];
		batchId?: string;
	};
	type AddStagePreview = GrowPreview & { stage: { name: string }; books: { id: string; code: string; included: boolean; reason: string | null }[] };
	const blankStage = () => ({
		name: '', category: 'layout', defaultDays: 1, isReview: false, isExternal: false, ignoresWindows: false,
		trackIds: {} as Record<string, boolean>, after: '', before: '', mode: 'insert' as 'insert' | 'alongside',
		bookIds: null as string[] | null
	});
	let newStage = $state(blankStage());
	let stagePreview = $state<AddStagePreview | null>(null);

	function addStageBody() {
		return {
			name: newStage.name.trim(), category: newStage.category, defaultDays: Number(newStage.defaultDays),
			isReview: newStage.isReview, isExternal: newStage.isExternal, ignoresWindows: newStage.ignoresWindows,
			trackIds: data.pipeline.tracks.filter((t) => newStage.trackIds[t.id]).map((t) => t.id),
			after: newStage.after || null, before: newStage.before || null, mode: newStage.mode,
			...(newStage.bookIds ? { bookIds: newStage.bookIds } : {})
		};
	}
	async function previewStage(e?: SubmitEvent) {
		e?.preventDefault();
		busy = true;
		pipeFlash = null;
		const res = await api<AddStagePreview>('POST', `/api/series/${data.series.id}/stages`, { ...addStageBody(), preview: true });
		busy = false;
		if (!res.ok) return (pipeFlash = { ok: false, text: res.message });
		stagePreview = res.data;
	}
	function toggleStageBook(id: string, on: boolean) {
		const current = newStage.bookIds ?? stagePreview?.books.filter((b) => b.included).map((b) => b.id) ?? [];
		newStage.bookIds = on ? [...current, id] : current.filter((x) => x !== id);
		previewStage();
	}
	async function confirmStage() {
		const name = newStage.name.trim();
		const result = await pipeCall('POST', `/api/series/${data.series.id}/stages`, addStageBody(), `Added ${name}.`);
		if (!result) return;
		stagePreview = null;
		lastPipeBatch = (result as unknown as GrowPreview).batchId ?? null;
		newStage = blankStage();
	}

	// Move a book to another track.
	type MovePreview = GrowPreview & { book: string; from: string; to: string; keeps: number; removes: string[]; keepsDone: string[] };
	let movePending = $state<{ bookId: string; trackId: string; preview: MovePreview } | null>(null);
	async function askMove(b: PBook, trackId: string) {
		if (!trackId || trackId === b.trackId) return (movePending = null);
		busy = true;
		pipeFlash = null;
		const res = await api<MovePreview>('PUT', `/api/books/${b.id}/track`, { trackId, preview: true });
		busy = false;
		if (!res.ok) return (pipeFlash = { ok: false, text: res.message });
		movePending = { bookId: b.id, trackId, preview: res.data };
	}
	async function confirmMove() {
		if (!movePending) return;
		const { bookId, trackId, preview: p } = movePending;
		const result = await pipeCall('PUT', `/api/books/${bookId}/track`, { trackId }, `Moved ${p.book} to ${p.to}.`);
		if (!result) return;
		movePending = null;
		lastPipeBatch = (result as unknown as GrowPreview).batchId ?? null;
	}

	// Remove a stage or a book: preview what is deleted, kept or archived, then confirm.
	type RemovePreview = {
		archive: boolean; reason?: string | null; deletesTasks: number; keepsTasks: number;
		relinked: number; books?: string[]; batchId?: string;
	};
	let removePending = $state<{ kind: 'stage' | 'book'; id: string; label: string; preview: RemovePreview } | null>(null);

	async function askRemove(kind: 'stage' | 'book', id: string, label: string) {
		busy = true;
		pipeFlash = null;
		const res = await api<RemovePreview>('DELETE', `/api/${kind}s/${id}`, { preview: true });
		busy = false;
		if (!res.ok) return (pipeFlash = { ok: false, text: res.message });
		removePending = { kind, id, label, preview: res.data };
	}

	async function confirmRemove() {
		if (!removePending) return;
		const { kind, id, label, preview: p } = removePending;
		const result = await pipeCall('DELETE', `/api/${kind}s/${id}`, {}, p.archive ? `Archived ${label}.` : `Removed ${label}.`);
		if (!result) return;
		removePending = null;
		lastPipeBatch = (result as unknown as RemovePreview).batchId ?? null;
	}

	function removeSummary(p: RemovePreview) {
		const parts: string[] = [];
		if (p.deletesTasks) parts.push(`${plural(p.deletesTasks, 'not-started task is', 'not-started tasks are')} deleted${p.books?.length ? ` (${p.books.join(', ')})` : ''}`);
		if (p.relinked) parts.push(`${plural(p.relinked, 'dependency is', 'dependencies are')} relinked around them`);
		parts.push(p.archive
			? `it is archived rather than deleted, because ${p.reason ?? `${plural(p.keepsTasks, 'Done task is', 'Done tasks are')} kept as history`}; it disappears from the matrix, swimlane and projections`
			: 'nothing has started, so it is deleted');
		return parts.join('; ');
	}

	// Skip a stage for one book, or lift a skip: preview, then confirm.
	type SkipPreview = {
		book: string; stage: string;
		deletesTask?: boolean; relinked?: number;
		task?: { startDate: string; endDate: string; window: string | null; scheduleState: string };
		pushed?: { label: string; from: string; to: string; scheduleState: string }[];
		batchId?: string;
	};
	let stagesOpenFor = $state<string | null>(null);
	let skipPending = $state<{ bookId: string; stageId: string; lift: boolean; preview: SkipPreview } | null>(null);

	async function toggleStage(b: PBook, stageId: string) {
		const lift = b.skippedStageIds.includes(stageId);
		busy = true;
		pipeFlash = null;
		const res = await api<SkipPreview>(lift ? 'DELETE' : 'PUT', `/api/books/${b.id}/skips/${stageId}`, { preview: true });
		busy = false;
		if (!res.ok) return (pipeFlash = { ok: false, text: res.message });
		skipPending = { bookId: b.id, stageId, lift, preview: res.data };
	}

	async function confirmSkip() {
		if (!skipPending) return;
		const { bookId, stageId, lift, preview: p } = skipPending;
		const result = await pipeCall(lift ? 'DELETE' : 'PUT', `/api/books/${bookId}/skips/${stageId}`, {},
			lift ? `Added ${p.stage} to ${p.book}.` : `${p.book} now skips ${p.stage}.`);
		if (!result) return;
		skipPending = null;
		lastPipeBatch = (result as unknown as SkipPreview).batchId ?? null;
	}

	// Add a book: preview its schedule, then confirm.
	type AddBookPreview = {
		tasks: { stage: string; startDate: string; endDate: string; window: string | null; scheduleState: string; assignees: number }[];
		skips: string[];
		dependencies: number;
		late: number;
		batchId?: string;
	};
	function nextWorkingDayFrom(iso: string) {
		const t = Date.parse(iso + 'T12:00:00Z');
		for (let d = t + DAY_MS; ; d += DAY_MS) {
			const dow = new Date(d).getUTCDay();
			if (dow !== 0 && dow !== 6) return new Date(d).toISOString().slice(0, 10);
		}
	}
	const blankBook = () => ({
		code: '', name: '', trackId: data.pipeline.tracks[0]?.id ?? '', groupLabel: '', batch: null as number | null,
		mode: 'like' as 'like' | 'date', likeBookId: '', fromDate: nextWorkingDayFrom(new Date().toISOString().slice(0, 10)),
		include: {} as Record<string, boolean>
	});
	let newBook = $state(blankBook());
	let bookPreview = $state<AddBookPreview | null>(null);
	const newBookStages = $derived(data.pipeline.tracks.find((t) => t.id === newBook.trackId)?.stageIds ?? []);
	const siblings = $derived(data.pipeline.books.filter((b) => b.trackId === newBook.trackId));

	function addBookBody() {
		const schedule = newBook.mode === 'like'
			? { likeBookId: newBook.likeBookId }
			: { fromDate: newBook.fromDate, skipStageIds: newBookStages.filter((id) => newBook.include[id] === false) };
		return {
			code: newBook.code.trim(), name: newBook.name.trim(), trackId: newBook.trackId,
			groupLabel: newBook.groupLabel.trim() || null, batch: newBook.batch ? Number(newBook.batch) : null, schedule
		};
	}

	async function previewBook(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		pipeFlash = null;
		const res = await api<AddBookPreview>('POST', `/api/series/${data.series.id}/books`, { ...addBookBody(), preview: true });
		busy = false;
		if (!res.ok) return (pipeFlash = { ok: false, text: res.message });
		bookPreview = res.data;
	}

	async function confirmBook() {
		const code = newBook.code.trim();
		const result = await pipeCall('POST', `/api/series/${data.series.id}/books`, addBookBody(), `Added ${code}.`);
		if (!result) return;
		bookPreview = null;
		lastPipeBatch = (result as unknown as AddBookPreview).batchId ?? null;
		newBook = blankBook();
	}

	// ── Team ────────────────────────────────────────────────────────────────
	type Draft = { role: string; teamLabel: string; capacity: number };
	const toDraft = (m: Member): Draft => ({ role: m.role, teamLabel: m.teamLabel ?? '', capacity: m.capacity });

	// One editable draft per member. After a reload, rows with unsaved edits keep them.
	const initialDrafts = () => Object.fromEntries(data.members.map((m) => [m.personId, toDraft(m)]));
	let drafts = $state<Record<string, Draft>>(initialDrafts());
	let synced: Record<string, Draft> = {};
	$effect(() => {
		const next: Record<string, Draft> = {};
		const current = untrack(() => drafts);
		for (const m of data.members) {
			const fresh = toDraft(m);
			const prev = current[m.personId];
			const old = synced[m.personId];
			const untouched = !prev || !old || JSON.stringify(prev) === JSON.stringify(old);
			next[m.personId] = untouched ? fresh : prev;
			synced[m.personId] = fresh;
		}
		drafts = next;
	});
	const isDirty = (m: Member) => {
		const d = drafts[m.personId];
		return !!d && (d.role !== m.role || d.teamLabel !== (m.teamLabel ?? '') || d.capacity !== m.capacity);
	};

	let teamFlash = $state<Flash>(null);
	let inviteFor = $state<string | null>(null);
	let inviteEmail = $state('');

	const groups = $derived.by(() => {
		const byLabel: Record<string, Member[]> = {};
		for (const m of data.members) (byLabel[m.teamLabel || 'No team label'] ??= []).push(m);
		return Object.entries(byLabel);
	});

	async function teamCall(method: string, url: string, body: unknown, okText: string) {
		busy = true;
		teamFlash = null;
		const res = await api(method, url, body);
		busy = false;
		teamFlash = res.ok ? { ok: true, text: okText } : { ok: false, text: res.message };
		if (res.ok) {
			inviteFor = null;
			await invalidateAll();
		}
		return res.ok;
	}

	function saveMember(m: Member) {
		const d = drafts[m.personId];
		teamCall('PUT', `/api/series/${data.series.id}/members/${m.personId}`,
			{ role: d.role, teamLabel: d.teamLabel || null, capacity: Number(d.capacity) }, `Updated ${m.displayName}.`);
	}

	function openInvite(m: Member) {
		inviteFor = inviteFor === m.personId ? null : m.personId;
		inviteEmail = m.email ?? '';
	}

	// Add an existing person, or a new placeholder.
	let addMode = $state<'existing' | 'new'>('existing');
	let add = $state({ personId: '', displayName: '', email: '', role: 'contributor', teamLabel: '', capacity: 1 });

	async function addMember(e: SubmitEvent) {
		e.preventDefault();
		const teamLabel = add.teamLabel.trim() || null;
		const ok =
			addMode === 'existing'
				? await teamCall('PUT', `/api/series/${data.series.id}/members/${add.personId}`,
					{ role: add.role, teamLabel, capacity: Number(add.capacity) }, 'Member added.')
				: await teamCall('POST', '/api/people',
					{ displayName: add.displayName.trim(), email: add.email.trim() || undefined, seriesId: data.series.id, role: add.role, teamLabel: teamLabel ?? undefined },
					`Added ${add.displayName.trim()}.`);
		if (ok) add = { personId: '', displayName: '', email: '', role: 'contributor', teamLabel: '', capacity: 1 };
	}

	const canEditRole = (m: Member) => data.me.isAdmin || m.role !== 'coordinator';
	const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
</script>

<svelte:head><title>Settings · {data.series.name}</title></svelte:head>

{#snippet impact(report: Report, cancel: () => void, apply: () => void)}
	<div class="impact" role="alertdialog" aria-label="Confirm schedule changes">
		<p><strong>This change re-plans the schedule:</strong> {summary(report)}.</p>
		<ul class="impact-list">
			{#each report.changes.slice(0, 8) as c (c.id)}
				<li>
					{c.label}:
					{#if c.kind === 'unscheduled'}becomes unscheduled
					{:else if c.kind === 'window'}{c.from.window ?? 'no window'} → {c.to.window ?? 'no window'}
					{:else}{fmtDate(c.from.startDate)} → {fmtDate(c.to.startDate)}{c.to.window ? ` (${c.to.window})` : ''}{/if}
				</li>
			{/each}
			{#each report.outsideWindow.slice(0, 4) as o (o.id)}
				<li class="warn">{o.label}: started, stays put, flagged Outside window</li>
			{/each}
		</ul>
		{#if report.changes.length > 8}<p class="hint">…and {report.changes.length - 8} more.</p>{/if}
		<div class="form-foot">
			<button type="button" class="btn btn-ghost btn-lg" onclick={cancel}>Cancel</button>
			<button type="button" class="btn btn-primary btn-lg" disabled={busy} onclick={apply}>Apply changes</button>
		</div>
	</div>
{/snippet}

{#snippet removePanel(colspan: number)}
	{#if removePending}
		{@const p = removePending}
		<tr class="expand">
			<td {colspan}>
				<div class="impact" role="alertdialog" aria-label="Confirm removal">
					<p><strong>Remove {p.label}:</strong> {removeSummary(p.preview)}.</p>
					<div class="form-foot">
						<button type="button" class="btn btn-ghost btn-lg" onclick={() => (removePending = null)}>Cancel</button>
						<button type="button" class="btn btn-danger btn-lg" disabled={busy} onclick={confirmRemove}>
							{p.preview.archive ? 'Archive' : 'Remove'} {p.label}
						</button>
					</div>
				</div>
			</td>
		</tr>
	{/if}
{/snippet}

<datalist id="team-labels">
	{#each data.teamLabels as l (l)}<option value={l}></option>{/each}
</datalist>

<div class="settings">
	<header class="page-header">
		<h1>{data.series.name} settings</h1>
		<nav class="toc" aria-label="Sections">
			<a href="#general">General</a>
			<a href="#print">Print and publishing</a>
			<a href="#windows">Windows</a>
			<a href="#pipeline">Pipeline</a>
			<a href="#team">Team</a>
		</nav>
	</header>

	<!-- General ─────────────────────────────────────────────────────────── -->
	<section id="general" class="card">
		<h2>General</h2>
		<form onsubmit={saveGeneral}>
			<div class="grid">
				<label class="field span-2">
					<span>Series name</span>
					<input class="input" bind:value={general.name} maxlength="120" required />
				</label>
				<label class="field">
					<span>Status</span>
					<select class="input" bind:value={general.status}>
						<option value="planning">Planning</option>
						<option value="active">Active</option>
						<option value="closed">Closed</option>
					</select>
				</label>
				<label class="field">
					<span>Starts</span>
					<input class="input" type="date" value={data.series.startDate} disabled />
				</label>
				<label class="field">
					<span>Target date</span>
					<input class="input" type="date" bind:value={general.targetDate} min={data.series.startDate} required />
				</label>
				<label class="field">
					<span>Hard limit <span class="hint">optional</span></span>
					<input class="input" type="date" bind:value={general.hardLimitDate} min={general.targetDate} />
				</label>
				<label class="field">
					<span>Book group label <span class="hint">e.g. Grade group</span></span>
					<input class="input" bind:value={general.bookGroupLabel} maxlength="40" required />
				</label>
			</div>

			<label class="switch">
				<input type="checkbox" bind:checked={general.enforceWindows} />
				<span>
					<strong>Enforce windows</strong>
					<span class="hint">Every task belongs to the window it starts in and can't cross its edge. Publishing stages are always exempt.</span>
				</span>
			</label>
			{#if general.enforceWindows}
				<label class="field overflow">
					<span>Overflow allowance <span class="hint">working days a task marked "Allow overflow" may run past its window</span></span>
					<input class="input" type="number" min="0" max="10" step="1" bind:value={general.windowOverflowDays} required />
				</label>
			{/if}
			<label class="switch">
				<input type="checkbox" bind:checked={general.strictMode} />
				<span>
					<strong>Strict mode</strong>
					<span class="hint">Block dropping a task before its predecessor ends, instead of flagging it at risk.</span>
				</span>
			</label>

			{#if pending}
				{@const p = pending}
				{@render impact(p.report, () => (pending = null), () => commitGeneral(p.body, p.report))}
			{/if}

			<div class="form-foot">
				{#if generalFlash}<p class="notice" class:notice--ok={generalFlash.ok} class:notice--error={!generalFlash.ok} role="status">{generalFlash.text}</p>{/if}
				{#if lastBatch}<button type="button" class="btn btn-ghost btn-lg" disabled={busy} onclick={undoLast}>Undo</button>{/if}
				<button class="btn btn-primary btn-lg" disabled={busy || !generalDirty || !!pending}>Save changes</button>
			</div>
		</form>
	</section>

	<!-- Print and publishing ────────────────────────────────────────────── -->
	<section id="print" class="card">
		<h2>Print and publishing</h2>
		<p class="lede">Defaults for new print records. Books that already have a print record keep their numbers.</p>
		<form onsubmit={savePrint}>
			<div class="grid">
				<label class="field">
					<span>Copies per book</span>
					<input class="input" type="number" min="0" step="1" bind:value={print.defaultCopies} required />
				</label>
				<label class="field">
					<span>Legal deposit copies</span>
					<input class="input" type="number" min="0" step="1" bind:value={print.legalDepositCopies} required />
				</label>
				<label class="field">
					<span>Print buffer <span class="hint">working days after each batch</span></span>
					<input class="input" type="number" min="0" max="30" step="1" bind:value={print.printBufferDays} required />
				</label>
			</div>
			<p class="hint">Each book prints {print.defaultCopies + print.legalDepositCopies} copies ({print.defaultCopies} planned + {print.legalDepositCopies} for legal deposit).</p>
			{#if applyPreview}
				{@const ap = applyPreview}
				<div class="impact" role="alertdialog" aria-label="Confirm applying print defaults">
					<p>
						<strong>Apply {ap.defaults.copiesPlanned} + {ap.defaults.depositCopies} copies to every book whose printing has not started.</strong>
						{#if ap.updated.length}Updates {ap.updated.map((u) => u.code).join(', ')}.{:else}No book needs changing.{/if}
						{#if ap.skipped.length}Skips {ap.skipped.map((s) => s.code).join(', ')} (printing has started).{/if}
					</p>
					<div class="form-foot">
						<button type="button" class="btn btn-ghost btn-lg" onclick={() => (applyPreview = null)}>Cancel</button>
						<button type="button" class="btn btn-primary btn-lg" disabled={busy || !ap.updated.length} onclick={confirmApply}>Apply</button>
					</div>
				</div>
			{/if}
			<div class="form-foot">
				{#if printFlash}<p class="notice" class:notice--ok={printFlash.ok} class:notice--error={!printFlash.ok} role="status">{printFlash.text}</p>{/if}
				{#if lastApplyBatch}<button type="button" class="btn btn-ghost btn-lg" disabled={busy} onclick={undoApply}>Undo</button>{/if}
				<button type="button" class="btn btn-ghost btn-lg" disabled={busy || printDirty || !!applyPreview}
					title={printDirty ? 'Save the new defaults first' : 'Copy these defaults into books already planned'}
					onclick={previewApply}>Apply to all books</button>
				<button class="btn btn-primary btn-lg" disabled={busy || !printDirty}>Save changes</button>
			</div>
		</form>
	</section>

	<!-- Windows ─────────────────────────────────────────────────────────── -->
	<section id="windows" class="card">
		<h2>Windows</h2>
		<p class="lede">
			{#if data.series.enforceWindows}
				Enforced. Every task belongs to the window it starts in. Changing a window re-plans the tasks it affects; you'll see the impact before anything is saved.
			{:else}
				Reference bands only. Changing them moves no tasks.
			{/if}
		</p>

		{#if data.unscheduled > 0}
			<p class="notice notice--error">
				{plural(data.unscheduled, 'task is', 'tasks are')} unscheduled because no window has room. Extend a window or add one to place them.
			</p>
		{/if}

		<div class="table-wrap">
			<table class="windows">
				<thead>
					<tr><th>Label</th><th>Starts</th><th>Ends</th><th class="num">Working days</th><th class="num">Tasks</th><th class="right">Actions</th></tr>
				</thead>
				<tbody>
					{#each data.windows as w (w.id)}
						{#if editingWin?.id === w.id}
							<tr class="expand">
								<td colspan="6">
									<form class="inline-form" onsubmit={saveWindow}>
										<label class="field grow">
											<span>Label</span>
											<input class="input" bind:value={editingWin.label} maxlength="60" required />
										</label>
										<label class="field">
											<span>Starts</span>
											<input class="input" type="date" bind:value={editingWin.startDate} required />
										</label>
										<label class="field">
											<span>Ends</span>
											<input class="input" type="date" bind:value={editingWin.endDate} min={editingWin.startDate} required />
										</label>
										<button class="btn btn-primary btn-lg" disabled={busy || !!winPending}>Save</button>
										<button type="button" class="btn btn-ghost btn-lg" onclick={() => { editingWin = null; winPending = null; }}>Cancel</button>
									</form>
								</td>
							</tr>
						{:else}
							<tr>
								<td class="name">{w.label}</td>
								<td>{fmtDate(w.startDate)}</td>
								<td>{fmtDate(w.endDate)}</td>
								<td class="num">{workingDays(w.startDate, w.endDate)}</td>
								<td class="num">{w.taskCount}</td>
								<td class="right">
									<div class="actions">
										<button class="btn btn-ghost" disabled={busy}
											onclick={() => { winPending = null; editingWin = { id: w.id, label: w.label, startDate: w.startDate, endDate: w.endDate }; }}>Edit</button>
										<button class="btn btn-danger" disabled={busy}
											onclick={() => windowCall({ method: 'DELETE', url: `/api/windows/${w.id}`, body: {}, okText: `Deleted "${w.label}".` })}>Delete</button>
									</div>
								</td>
							</tr>
						{/if}
					{:else}
						<tr><td colspan="6" class="empty">No windows yet.</td></tr>
					{/each}
				</tbody>
			</table>
		</div>

		{#if winPending}
			{@const p = winPending}
			{@render impact(p.report, () => (winPending = null), () => commitWindow(p, p.report))}
		{/if}

		{#if winFlash || lastWinBatch}
			<div class="form-foot">
				{#if winFlash}<p class="notice" class:notice--ok={winFlash.ok} class:notice--error={!winFlash.ok} role="status">{winFlash.text}</p>{/if}
				{#if lastWinBatch}<button type="button" class="btn btn-ghost btn-lg" disabled={busy} onclick={undoWindow}>Undo</button>{/if}
			</div>
		{/if}

		<form class="add-member" onsubmit={addWindow}>
			<h3>Add a window</h3>
			<div class="add-fields">
				<label class="field grow">
					<span>Label</span>
					<input class="input" bind:value={newWin.label} maxlength="60" placeholder="e.g. Reserve: Dec 16 to 18" required />
				</label>
				<label class="field">
					<span>Starts</span>
					<input class="input" type="date" bind:value={newWin.startDate} required />
				</label>
				<label class="field">
					<span>Ends</span>
					<input class="input" type="date" bind:value={newWin.endDate} min={newWin.startDate} required />
				</label>
				<button class="btn btn-primary btn-lg" disabled={busy || !!winPending}>Add</button>
			</div>
		</form>
	</section>

	<!-- Pipeline ────────────────────────────────────────────────────────── -->
	<section id="pipeline" class="card">
		<h2 data-tour="settings-pipeline">Pipeline</h2>
		<p class="lede">
			Tracks, stages and books. Edits here never create or delete tasks. Changing a stage's window exemption or deadline
			shows the impact before anything is saved.
		</p>

		{#if pipeFlash || lastPipeBatch}
			<div class="form-foot">
				{#if pipeFlash}<p class="notice" class:notice--ok={pipeFlash.ok} class:notice--error={!pipeFlash.ok} role="status">{pipeFlash.text}</p>{/if}
				{#if lastPipeBatch}<button type="button" class="btn btn-ghost btn-lg" disabled={busy} onclick={undoPipe}>Undo</button>{/if}
			</div>
		{/if}

		<h3>Tracks</h3>
		<ul class="tracks">
			{#each data.pipeline.tracks as t, i (t.id)}
				<li>
					<div class="order">
						<button class="btn-icon" aria-label="Move {t.name} up" disabled={busy || i === 0} onclick={() => move('track', data.pipeline.tracks, i, -1)}>↑</button>
						<button class="btn-icon" aria-label="Move {t.name} down" disabled={busy || i === data.pipeline.tracks.length - 1} onclick={() => move('track', data.pipeline.tracks, i, 1)}>↓</button>
					</div>
					{#if renamingTrack?.id === t.id}
						<form class="inline-form grow" onsubmit={renameTrack}>
							<!-- svelte-ignore a11y_autofocus -->
							<input class="input grow" bind:value={renamingTrack.name} maxlength="60" required autofocus aria-label="Track name" />
							<button class="btn btn-primary" disabled={busy}>Save</button>
							<button type="button" class="btn btn-ghost" onclick={() => (renamingTrack = null)}>Cancel</button>
						</form>
					{:else}
						<div class="grow">
							<div class="name">{t.name}</div>
							<div class="chain">
								{#each t.stageIds as sid, k (sid)}{k ? ' → ' : ''}{stageName.get(sid)}{/each}
							</div>
						</div>
						<button class="btn btn-ghost" onclick={() => (renamingTrack = { id: t.id, name: t.name })}>Rename</button>
						<button class="btn btn-danger" disabled={busy || t.bookCount > 0}
							title={t.bookCount ? `${plural(t.bookCount, 'book follows', 'books follow')} this track` : undefined}
							onclick={() => deleteTrack(t.id, t.name)}>Delete</button>
					{/if}
				</li>
			{/each}
		</ul>
		<form class="add-member" onsubmit={addTrack}>
			<h3>Add a track</h3>
			<div class="add-fields">
				<label class="field grow">
					<span>Name</span>
					<input class="input" bind:value={newTrack.name} maxlength="60" placeholder="e.g. Workbook track" required />
				</label>
			</div>
			<fieldset class="stage-picks">
				<legend>Stages, in matrix order</legend>
				{#each data.pipeline.stages as s (s.id)}
					<label><input type="checkbox" checked={!!newTrack.include[s.id]} onchange={(e) => (newTrack.include[s.id] = e.currentTarget.checked)} /> {s.name}</label>
				{/each}
			</fieldset>
			<div class="form-foot"><button class="btn btn-primary btn-lg" disabled={busy}>Add track</button></div>
		</form>

		<h3>Stages <span class="hint">in matrix column order; reordering does not change dependencies</span></h3>
		<div class="table-wrap">
			<table class="stages">
				<thead>
					<tr>
						<th></th><th>Name</th><th>Category</th><th class="num">Days</th>
						<th title="Review stage">Review</th><th title="Done by an outside body">External</th><th title="Ignores windows">No windows</th>
						<th>Deadline</th><th class="num">Tasks</th><th></th>
					</tr>
				</thead>
				<tbody>
					{#each data.pipeline.stages as s, i (s.id)}
						{@const d = stageDrafts[s.id]}
						{#if d}
							<tr>
								<td class="order">
									<button class="btn-icon" aria-label="Move {s.name} up" disabled={busy || i === 0} onclick={() => move('stage', data.pipeline.stages, i, -1)}>↑</button>
									<button class="btn-icon" aria-label="Move {s.name} down" disabled={busy || i === data.pipeline.stages.length - 1} onclick={() => move('stage', data.pipeline.stages, i, 1)}>↓</button>
								</td>
								<td>
									<input class="input" bind:value={d.name} maxlength="60" aria-label="Stage name" />
									<div class="muted">{s.trackNames.join(', ') || 'No track'}</div>
								</td>
								<td>
									<select class="input" bind:value={d.category} aria-label="Category">
										{#each CATEGORIES as c (c)}
											<option value={c} disabled={s.taskCount > 0 && (c === 'gate') !== (s.category === 'gate')}>{CATEGORY_LABEL[c]}</option>
										{/each}
									</select>
								</td>
								<td class="num"><input class="input days" type="number" min="0" max="60" bind:value={d.defaultDays} aria-label="Default days" /></td>
								<td class="check"><input type="checkbox" bind:checked={d.isReview} aria-label="Review stage" /></td>
								<td class="check"><input type="checkbox" bind:checked={d.isExternal} aria-label="External" /></td>
								<td class="check"><input type="checkbox" bind:checked={d.ignoresWindows} aria-label="Ignores windows" /></td>
								<td class="deadline">
									<select class="input" bind:value={d.deadlineAfter} aria-label="Deadline counts from">
										<option value="">None</option>
										{#each data.pipeline.stages.filter((x) => x.id !== s.id) as o (o.id)}<option value={o.key}>after {o.name}</option>{/each}
									</select>
									{#if d.deadlineAfter}
										<span class="dl-amount">
											+<input class="input days" type="number" min="0" max="36" bind:value={d.deadlineMonths} aria-label="Months" /> mo
											<input class="input days" type="number" min="0" max="365" bind:value={d.deadlineDays} aria-label="Days" /> d
										</span>
									{/if}
								</td>
								<td class="num">{s.taskCount}</td>
								<td class="right">
									<div class="actions">
										{#if stageDirty(s)}
											<button class="btn btn-primary" disabled={busy || !!stagePending} onclick={() => saveStage(s)}>Save</button>
											<button class="btn btn-ghost" onclick={() => (stageDrafts[s.id] = stageDraft(s))}>Undo</button>
										{/if}
										<button class="btn btn-danger" disabled={busy || !!removePending} onclick={() => askRemove('stage', s.id, s.name)}>Remove</button>
									</div>
								</td>
							</tr>
							{#if removePending?.kind === 'stage' && removePending.id === s.id}{@render removePanel(10)}{/if}
							{#if stagePending?.stage.id === s.id}
								{@const p = stagePending}
								<tr class="expand">
									<td colspan="10">
										{#if impactful(p.result.report)}
											{@render impact(p.result.report, () => (stagePending = null), () => commitStage(p.stage, p.body))}
										{:else}
											<div class="impact" role="alertdialog" aria-label="Confirm due date changes">
												<p><strong>This change updates {plural(p.result.dueDates.length, 'due date', 'due dates')}:</strong></p>
												<ul class="impact-list">
													{#each p.result.dueDates.slice(0, 8) as c (c.id)}
														<li>{c.label}: {c.from ? fmtDate(c.from) : 'none'} → {c.to ? fmtDate(c.to) : 'none'}</li>
													{/each}
												</ul>
												{#if p.result.dueDates.length > 8}<p class="hint">…and {p.result.dueDates.length - 8} more.</p>{/if}
												<div class="form-foot">
													<button type="button" class="btn btn-ghost btn-lg" onclick={() => (stagePending = null)}>Cancel</button>
													<button type="button" class="btn btn-primary btn-lg" disabled={busy} onclick={() => commitStage(p.stage, p.body)}>Apply changes</button>
												</div>
											</div>
										{/if}
									</td>
								</tr>
							{/if}
						{/if}
					{/each}
				</tbody>
			</table>
		</div>

		<form class="add-member" onsubmit={previewStage}>
			<h3>Add a stage</h3>
			<div class="add-fields">
				<label class="field grow">
					<span>Name</span>
					<input class="input" bind:value={newStage.name} maxlength="60" placeholder="e.g. Cover design" required oninput={() => (stagePreview = null)} />
				</label>
				<label class="field">
					<span>Category</span>
					<select class="input" bind:value={newStage.category} onchange={() => { stagePreview = null; if (newStage.category === 'gate') newStage.defaultDays = 0; }}>
						{#each CATEGORIES as c (c)}<option value={c}>{CATEGORY_LABEL[c]}</option>{/each}
					</select>
				</label>
				<label class="field">
					<span>Default days</span>
					<input class="input days" type="number" min="0" max="60" bind:value={newStage.defaultDays} oninput={() => (stagePreview = null)} />
				</label>
			</div>
			<div class="seg">
				<label><input type="checkbox" bind:checked={newStage.isReview} /> Review stage</label>
				<label><input type="checkbox" bind:checked={newStage.isExternal} /> Done by an outside body</label>
				<label><input type="checkbox" bind:checked={newStage.ignoresWindows} /> Ignores windows</label>
			</div>
			<fieldset class="stage-picks">
				<legend>Tracks that get it</legend>
				{#each data.pipeline.tracks as t (t.id)}
					<label><input type="checkbox" checked={!!newStage.trackIds[t.id]} onchange={(e) => { newStage.trackIds[t.id] = e.currentTarget.checked; newStage.bookIds = null; stagePreview = null; }} /> {t.name}</label>
				{/each}
			</fieldset>
			<div class="add-fields">
				<label class="field">
					<span>Starts after</span>
					<select class="input" bind:value={newStage.after} onchange={() => (stagePreview = null)}>
						<option value="">Nothing (first)</option>
						{#each data.pipeline.stages as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
					</select>
				</label>
				<label class="field">
					<span>Finishes before</span>
					<select class="input" bind:value={newStage.before} onchange={() => { newStage.bookIds = null; stagePreview = null; }}>
						<option value="">Nothing (last)</option>
						{#each data.pipeline.stages as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
					</select>
				</label>
				<div class="seg" role="radiogroup" aria-label="How it joins">
					<label title="Replaces the direct link between the two stages"><input type="radio" bind:group={newStage.mode} value="insert" onchange={() => (stagePreview = null)} /> Insert into the chain</label>
					<label title="Keeps the direct link, as the ISBN process runs alongside layout"><input type="radio" bind:group={newStage.mode} value="alongside" onchange={() => (stagePreview = null)} /> Run alongside</label>
				</div>
			</div>

			{#if stagePreview}
				{@const sp = stagePreview}
				<div class="impact" role="alertdialog" aria-label="Confirm new stage">
					<p>
						<strong>{sp.stage.name}</strong> gives {plural(sp.tasks.length, 'book a task', 'books a task')}, adds
						{plural(sp.linked, 'link', 'links')}{#if sp.unlinked}, replaces {plural(sp.unlinked, 'direct link', 'direct links')}{/if}{#if sp.pushed.length}, and pushes {plural(sp.pushed.length, 'task', 'tasks')} later{/if}.
						Unticked books record a skip.
					</p>
					<div class="stage-picks">
						{#each sp.books as b (b.id)}
							<label title={b.reason ?? undefined}>
								<input type="checkbox" checked={b.included} disabled={busy} onchange={(e) => toggleStageBook(b.id, e.currentTarget.checked)} />
								{b.code}{#if b.reason}<span class="hint"> ({b.reason})</span>{/if}
							</label>
						{/each}
					</div>
					{#if sp.tasks.length}
						<ul class="impact-list">
							{#each sp.tasks.slice(0, 6) as t (t.book)}
								<li class:warn={t.scheduleState === 'unscheduled'}>{t.book}: {fmtDate(t.startDate)} → {fmtDate(t.endDate)} {t.scheduleState === 'unscheduled' ? '(unscheduled)' : t.window ? `(${t.window})` : ''}</li>
							{/each}
						</ul>
					{/if}
					<div class="form-foot">
						<button type="button" class="btn btn-ghost btn-lg" onclick={() => (stagePreview = null)}>Cancel</button>
						<button type="button" class="btn btn-primary btn-lg" disabled={busy} onclick={confirmStage}>Add stage</button>
					</div>
				</div>
			{:else}
				<div class="form-foot"><button class="btn btn-primary btn-lg" disabled={busy}>Preview</button></div>
			{/if}
		</form>

		<h3>Books</h3>
		<datalist id="group-labels">{#each groupLabels as g (g)}<option value={g}></option>{/each}</datalist>
		<div class="table-wrap">
			<table>
				<thead>
					<tr><th></th><th>Code</th><th>Name</th><th>{data.series.bookGroupLabel}</th><th class="num">Batch</th><th>Track</th><th class="num">Tasks</th><th></th></tr>
				</thead>
				<tbody>
					{#each data.pipeline.books as b, i (b.id)}
						{@const d = bookDrafts[b.id]}
						{#if d}
							<tr>
								<td class="order">
									<button class="btn-icon" aria-label="Move {b.code} up" disabled={busy || i === 0} onclick={() => move('book', data.pipeline.books, i, -1)}>↑</button>
									<button class="btn-icon" aria-label="Move {b.code} down" disabled={busy || i === data.pipeline.books.length - 1} onclick={() => move('book', data.pipeline.books, i, 1)}>↓</button>
								</td>
								<td><input class="input code" bind:value={d.code} maxlength="20" aria-label="Code" /></td>
								<td><input class="input" bind:value={d.name} maxlength="120" aria-label="Name" /></td>
								<td><input class="input" list="group-labels" bind:value={d.groupLabel} maxlength="60" placeholder="None" aria-label={data.series.bookGroupLabel} /></td>
								<td class="num"><input class="input days" type="number" min="1" max="99" bind:value={d.batch} aria-label="Batch" /></td>
								<td>
									<select class="input" aria-label="Track" value={movePending?.bookId === b.id ? movePending.trackId : b.trackId} disabled={busy}
										onchange={(e) => askMove(b, e.currentTarget.value)}>
										{#each data.pipeline.tracks as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
									</select>
								</td>
								<td class="num">{b.taskCount}</td>
								<td class="right">
									<div class="actions">
										{#if bookDirty(b)}
											<button class="btn btn-primary" disabled={busy} onclick={() => saveBook(b)}>Save</button>
											<button class="btn btn-ghost" onclick={() => (bookDrafts[b.id] = bookDraft(b))}>Undo</button>
										{/if}
										<button class="btn btn-ghost" aria-expanded={stagesOpenFor === b.id}
											onclick={() => { stagesOpenFor = stagesOpenFor === b.id ? null : b.id; skipPending = null; }}>Stages</button>
										<button class="btn btn-danger" disabled={busy || !!removePending} onclick={() => askRemove('book', b.id, b.code)}>Remove</button>
									</div>
								</td>
							</tr>
							{#if removePending?.kind === 'book' && removePending.id === b.id}{@render removePanel(8)}{/if}
							{#if movePending?.bookId === b.id}
								{@const mp = movePending.preview}
								<tr class="expand">
									<td colspan="8">
										<div class="impact" role="alertdialog" aria-label="Confirm track change">
											<p>
												<strong>Move {mp.book} from {mp.from} to {mp.to}:</strong>
												{plural(mp.keeps, 'shared stage keeps its task', 'shared stages keep their tasks')}, progress included.
												{#if mp.removes.length}Removes {mp.removes.join(', ')}.{/if}
												{#if mp.keepsDone.length}Keeps {mp.keepsDone.join(', ')} as Done history.{/if}
												{#if mp.tasks.length}Adds {mp.tasks.map((t) => t.stage).join(', ')}.{/if}
												{#if mp.pushed.length}Pushes {plural(mp.pushed.length, 'task', 'tasks')} later.{/if}
											</p>
											{#if mp.tasks.length}
												<ul class="impact-list">
													{#each mp.tasks as t (t.stage)}
														<li class:warn={t.scheduleState === 'unscheduled'}>{t.stage}: {fmtDate(t.startDate)} → {fmtDate(t.endDate)} {t.scheduleState === 'unscheduled' ? '(unscheduled)' : t.window ? `(${t.window})` : ''}</li>
													{/each}
												</ul>
											{/if}
											<div class="form-foot">
												<button type="button" class="btn btn-ghost btn-lg" onclick={() => (movePending = null)}>Cancel</button>
												<button type="button" class="btn btn-primary btn-lg" disabled={busy} onclick={confirmMove}>Move {mp.book}</button>
											</div>
										</div>
									</td>
								</tr>
							{/if}
							{#if stagesOpenFor === b.id}
								{@const trackStageIds = data.pipeline.tracks.find((t) => t.id === b.trackId)?.stageIds ?? []}
								<tr class="expand">
									<td colspan="8">
										<p class="hint">Stages {b.code} has. Click one to skip it for this book, or to add a skipped one back.</p>
										<div class="stage-chips">
											{#each trackStageIds as sid (sid)}
												{@const skipped = b.skippedStageIds.includes(sid)}
												<button class="stage-chip" class:skipped disabled={busy || !!skipPending}
													title={skipped ? 'Skipped: click to add it back' : 'Click to skip for this book'}
													onclick={() => toggleStage(b, sid)}>{stageName.get(sid)}</button>
											{/each}
										</div>
										{#if skipPending?.bookId === b.id}
											{@const p = skipPending.preview}
											<div class="impact" role="alertdialog" aria-label="Confirm stage change">
												{#if skipPending.lift}
													<p>
														<strong>Add {p.stage} to {p.book}:</strong>
														{p.task ? `${fmtDate(p.task.startDate)} → ${fmtDate(p.task.endDate)}` : ''}
														{p.task?.scheduleState === 'unscheduled' ? '(unscheduled: no window has room)' : p.task?.window ? `(${p.task.window})` : ''}.
														{#if p.pushed?.length}It pushes {plural(p.pushed.length, 'task', 'tasks')}:{/if}
													</p>
													{#if p.pushed?.length}
														<ul class="impact-list">
															{#each p.pushed.slice(0, 6) as x (x.label)}<li>{x.label}: {fmtDate(x.from)} → {fmtDate(x.to)}</li>{/each}
														</ul>
													{/if}
												{:else}
													<p>
														<strong>Skip {p.stage} for {p.book}.</strong>
														{p.deletesTask ? `Its task is removed${p.relinked ? ` and ${plural(p.relinked, 'dependency is', 'dependencies are')} relinked around it` : ''}.` : 'It has no task yet.'}
													</p>
												{/if}
												<div class="form-foot">
													<button type="button" class="btn btn-ghost btn-lg" onclick={() => (skipPending = null)}>Cancel</button>
													<button type="button" class="btn btn-primary btn-lg" disabled={busy} onclick={confirmSkip}>
														{skipPending.lift ? 'Add stage' : 'Skip stage'}
													</button>
												</div>
											</div>
										{/if}
									</td>
								</tr>
							{/if}
						{/if}
					{/each}
				</tbody>
			</table>
		</div>
		<form class="add-member" onsubmit={previewBook}>
			<h3>Add a book</h3>
			<div class="add-fields">
				<label class="field">
					<span>Code</span>
					<input class="input code" bind:value={newBook.code} maxlength="20" placeholder="e.g. G6B" required />
				</label>
				<label class="field grow">
					<span>Name</span>
					<input class="input" bind:value={newBook.name} maxlength="120" required />
				</label>
				<label class="field">
					<span>Track</span>
					<select class="input" bind:value={newBook.trackId} onchange={() => { newBook.likeBookId = ''; newBook.include = {}; bookPreview = null; }}>
						{#each data.pipeline.tracks as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
					</select>
				</label>
				<label class="field">
					<span>{data.series.bookGroupLabel}</span>
					<input class="input" list="group-labels" bind:value={newBook.groupLabel} maxlength="60" />
				</label>
				<label class="field">
					<span>Batch</span>
					<input class="input days" type="number" min="1" max="99" bind:value={newBook.batch} />
				</label>
			</div>

			<div class="seg" role="radiogroup" aria-label="How to schedule it">
				<label><input type="radio" bind:group={newBook.mode} value="like" onchange={() => (bookPreview = null)} /> Like another book</label>
				<label><input type="radio" bind:group={newBook.mode} value="date" onchange={() => (bookPreview = null)} /> From a date</label>
			</div>

			{#if newBook.mode === 'like'}
				<label class="field">
					<span>Copy dates, windows, skips and assignees from <span class="hint">same track only</span></span>
					<select class="input" bind:value={newBook.likeBookId} required>
						<option value="" disabled>Choose a book…</option>
						{#each siblings as b (b.id)}<option value={b.id}>{b.code} · {b.name}</option>{/each}
					</select>
				</label>
			{:else}
				<div class="add-fields">
					<label class="field">
						<span>Start no earlier than</span>
						<input class="input" type="date" bind:value={newBook.fromDate} required />
					</label>
				</div>
				<fieldset class="stage-picks">
					<legend>Stages this book has <span class="hint">untick to skip</span></legend>
					{#each newBookStages as sid (sid)}
						<label><input type="checkbox" checked={newBook.include[sid] !== false} onchange={(e) => (newBook.include[sid] = e.currentTarget.checked)} /> {stageName.get(sid)}</label>
					{/each}
				</fieldset>
			{/if}

			{#if bookPreview}
				{@const unscheduledCount = bookPreview.tasks.filter((t) => t.scheduleState === 'unscheduled').length}
				<div class="impact" role="alertdialog" aria-label="Confirm new book">
					<p>
						<strong>{newBook.code || 'This book'} gets {plural(bookPreview.tasks.length, 'task', 'tasks')}</strong>
						and {plural(bookPreview.dependencies, 'dependency', 'dependencies')}{#if bookPreview.skips.length}, skipping {bookPreview.skips.join(', ')}{/if}.
						{#if unscheduledCount}{plural(unscheduledCount, 'task has', 'tasks have')} no window with room and will be unscheduled.{/if}
						{#if bookPreview.late}{plural(bookPreview.late, 'task ends', 'tasks end')} before today and will show as Late.{/if}
					</p>
					<ul class="impact-list">
						{#each bookPreview.tasks as t (t.stage)}
							<li class:warn={t.scheduleState === 'unscheduled'}>
								{t.stage}: {fmtDate(t.startDate)} → {fmtDate(t.endDate)}
								{t.scheduleState === 'unscheduled' ? '(unscheduled)' : t.window ? `(${t.window})` : ''}
							</li>
						{/each}
					</ul>
					<div class="form-foot">
						<button type="button" class="btn btn-ghost btn-lg" onclick={() => (bookPreview = null)}>Cancel</button>
						<button type="button" class="btn btn-primary btn-lg" disabled={busy} onclick={confirmBook}>Add book</button>
					</div>
				</div>
			{:else}
				<div class="form-foot"><button class="btn btn-primary btn-lg" disabled={busy}>Preview</button></div>
			{/if}
		</form>
		{#if data.pipeline.archived.stages.length || data.pipeline.archived.books.length}
			<div class="archived">
				<h3>Archived <span class="hint">kept because they hold Done work; hidden from the matrix, swimlane and projections</span></h3>
				{#if data.pipeline.archived.stages.length}
					<p>Stages: {data.pipeline.archived.stages.map((s) => `${s.name} (${fmtDate(s.archivedAt)})`).join(', ')}</p>
				{/if}
				{#if data.pipeline.archived.books.length}
					<p>Books: {data.pipeline.archived.books.map((b) => `${b.code} · ${b.name} (${fmtDate(b.archivedAt)})`).join(', ')}</p>
				{/if}
			</div>
		{/if}

		<h3>Save as a template</h3>
		<form class="tpl-save" onsubmit={saveAsTemplate}>
			<p class="hint">Copies the tracks, stages, dependency pattern, team labels and settings (not books, windows or dates), so a new series can start from them.</p>
			<label class="field"><span>Template name</span><input class="input" bind:value={tplName} required maxlength="80" placeholder="Learner book series" /></label>
			<button class="btn btn-ghost btn-lg" disabled={busy || !tplName.trim()}>Save template</button>
			{#if tplFlash}<p class="notice" class:notice--ok={tplFlash.ok} class:notice--error={!tplFlash.ok} role="status">{tplFlash.text}</p>{/if}
		</form>
	</section>

	<!-- Team ────────────────────────────────────────────────────────────── -->
	<section id="team" class="card">
		<h2>Team</h2>
		<p class="lede">Roles set what people can do on this series. Team labels group swimlane lanes and the workload view. Capacity is task days per working day.</p>

		{#if teamFlash}<p class="notice" class:notice--ok={teamFlash.ok} class:notice--error={!teamFlash.ok} role="status">{teamFlash.text}</p>{/if}

		<div class="table-wrap">
			<table>
				<thead>
					<tr><th>Person</th><th>Role</th><th>Team label</th><th class="num">Capacity</th><th class="right">Actions</th></tr>
				</thead>
				{#each groups as [label, list] (label)}
					<tbody>
						<tr class="group-row"><th colspan="5">{label} <span class="n">{list.length}</span></th></tr>
						{#each list as m (m.personId)}
							{@const d = drafts[m.personId]}
							{#if d}
								<tr class:dim={m.status === 'deactivated'}>
									<td>
										<div class="name">{m.displayName}{#if m.personId === data.me.personId}<span class="tag">You</span>{/if}</div>
										<div class="muted">
											<span class="status" data-status={m.status}>{STATUS_LABEL[m.status]}</span>
											{#if m.invite}expires {fmtDate(m.invite.expiresAt)}{:else}{m.email ?? ''}{/if}
										</div>
									</td>
									<td>
										<select class="input" bind:value={d.role} disabled={!canEditRole(m)}
											title={canEditRole(m) ? undefined : 'Only an admin can change a coordinator'}>
											{#each Object.entries(ROLE_LABEL) as [value, text] (value)}
												<option {value} disabled={value === 'coordinator' && !data.me.isAdmin && m.role !== 'coordinator'}>{text}</option>
											{/each}
										</select>
									</td>
									<td><input class="input" list="team-labels" bind:value={d.teamLabel} maxlength="60" placeholder="None" /></td>
									<td class="num"><input class="input cap" type="number" min="0.25" max="20" step="0.25" bind:value={d.capacity} /></td>
									<td class="right">
										<div class="actions">
											{#if isDirty(m)}
												<button class="btn btn-primary" disabled={busy} onclick={() => saveMember(m)}>Save</button>
												<button class="btn btn-ghost" onclick={() => (drafts[m.personId] = toDraft(m))}>Undo</button>
											{/if}
											{#if m.status === 'placeholder' || m.status === 'invited'}
												<button class="btn btn-ghost" onclick={() => openInvite(m)}>{m.invite ? 'Resend' : 'Invite'}</button>
											{/if}
											{#if m.invite && (data.me.isAdmin || m.invite.invitedBy === data.me.personId)}
												<button class="btn btn-ghost" disabled={busy}
													onclick={() => teamCall('DELETE', `/api/invites/${m.invite!.id}`, undefined, 'Invite revoked.')}>Revoke</button>
											{/if}
										</div>
									</td>
								</tr>
								{#if inviteFor === m.personId}
									<tr class="expand">
										<td colspan="5">
											<form class="inline-form" onsubmit={(e) => { e.preventDefault(); teamCall('POST', `/api/people/${m.personId}/invite`, { email: inviteEmail.trim() }, `Invite sent to ${inviteEmail.trim()}.`); }}>
												<label class="field grow">
													<span>Send {m.invite ? 'a new' : 'an'} invite to</span>
													<!-- svelte-ignore a11y_autofocus -->
													<input class="input" type="email" bind:value={inviteEmail} required autofocus />
												</label>
												<button class="btn btn-primary btn-lg" disabled={busy}>Send invite</button>
												<button type="button" class="btn btn-ghost btn-lg" onclick={() => (inviteFor = null)}>Cancel</button>
											</form>
										</td>
									</tr>
								{/if}
							{/if}
						{/each}
					</tbody>
				{/each}
			</table>
		</div>

		<form class="add-member" onsubmit={addMember}>
			<div class="add-head">
				<h3>Add to team</h3>
				<div class="seg" role="radiogroup" aria-label="Who to add">
					<label><input type="radio" bind:group={addMode} value="existing" /> Existing person</label>
					<label><input type="radio" bind:group={addMode} value="new" /> New placeholder</label>
				</div>
			</div>
			<div class="add-fields">
				{#if addMode === 'existing'}
					<label class="field grow">
						<span>Person</span>
						<select class="input" bind:value={add.personId} required>
							<option value="" disabled>Choose…</option>
							{#each data.others as p (p.id)}<option value={p.id}>{p.displayName}</option>{/each}
						</select>
					</label>
				{:else}
					<label class="field grow">
						<span>Display name</span>
						<input class="input" bind:value={add.displayName} maxlength="80" placeholder="e.g. Reviewer 5" required />
					</label>
					<label class="field grow">
						<span>Email <span class="hint">optional</span></span>
						<input class="input" type="email" bind:value={add.email} />
					</label>
				{/if}
				<label class="field">
					<span>Role</span>
					<select class="input" bind:value={add.role}>
						{#each Object.entries(ROLE_LABEL) as [value, text] (value)}
							<option {value} disabled={value === 'coordinator' && !data.me.isAdmin}>{text}</option>
						{/each}
					</select>
				</label>
				<label class="field">
					<span>Team label</span>
					<input class="input" list="team-labels" bind:value={add.teamLabel} maxlength="60" placeholder="None" />
				</label>
				{#if addMode === 'existing'}
					<label class="field">
						<span>Capacity</span>
						<input class="input cap" type="number" min="0.25" max="20" step="0.25" bind:value={add.capacity} />
					</label>
				{/if}
				<button class="btn btn-primary btn-lg" disabled={busy}>Add</button>
			</div>
		</form>
	</section>
</div>

<style>
	.settings { max-width: 960px; margin: 0 auto; padding: var(--sp-6) var(--sp-4) var(--sp-8); display: flex; flex-direction: column; gap: var(--sp-6); }
	.page-header { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--sp-3); }
	.page-header h1 { font-size: 22px; font-weight: 700; }
	.toc { display: flex; flex-wrap: wrap; gap: var(--sp-4); font-size: 13px; }

	.card { border: 1px solid var(--border); border-radius: var(--radius); padding: var(--sp-5) var(--sp-5) var(--sp-6); display: flex; flex-direction: column; gap: var(--sp-4); scroll-margin-top: 64px; }
	.card h2 { font-size: 16px; font-weight: 700; }
	.card h3 { font-size: 14px; font-weight: 600; }
	.lede { margin: calc(-1 * var(--sp-2)) 0 0; color: var(--muted-foreground); font-size: 13px; }
	form { display: flex; flex-direction: column; gap: var(--sp-4); }

	.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: var(--sp-4); }
	.span-2 { grid-column: span 2; }
	@media (max-width: 480px) { .span-2 { grid-column: auto; } }

	.switch { display: flex; gap: var(--sp-3); align-items: flex-start; cursor: pointer; }
	.switch input { margin-top: 3px; accent-color: var(--primary); width: 16px; height: 16px; flex-shrink: 0; }
	.switch > span { display: flex; flex-direction: column; font-size: 13px; }
	.hint { font-size: 12px; color: var(--muted-foreground); }

	.overflow { max-width: 340px; margin-left: 28px; }

	/* Pipeline */
	.tracks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-2); }
	.tracks li { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-2) var(--sp-3); border: 1px solid var(--border); border-radius: var(--radius-sm); }
	.chain { font-size: 12px; color: var(--muted-foreground); }
	.order { white-space: nowrap; display: flex; gap: 2px; }
	td.order { display: table-cell; }
	.btn-icon { border: 1px solid var(--border); background: var(--background); border-radius: var(--radius-sm); width: 24px; height: 24px; padding: 0; font-size: 12px; color: var(--muted-foreground); }
	.btn-icon:hover:not(:disabled) { background: var(--muted); color: var(--foreground); }
	.btn-icon:disabled { opacity: 0.35; cursor: default; }
	table.stages td { vertical-align: top; }
	td .input.days { width: 56px; min-width: 0; }
	td .input.code { min-width: 70px; width: 80px; }
	td.check { text-align: center; padding-top: 14px; }
	td.check input { accent-color: var(--primary); width: 16px; height: 16px; }
	.deadline { min-width: 180px; }
	.archived { border: 1px dashed var(--border); border-radius: var(--radius-sm); padding: var(--sp-3); font-size: 13px; color: var(--muted-foreground); }
	.archived p { margin: var(--sp-1) 0 0; }
	.stage-chips { display: flex; flex-wrap: wrap; gap: var(--sp-2); margin: var(--sp-2) 0; }
	.stage-chip { font-size: 12px; padding: 2px 10px; border-radius: 999px; border: 1px solid var(--primary); background: var(--primary-subtle); color: var(--primary-subtle-foreground); }
	.stage-chip.skipped { border-style: dashed; border-color: var(--border); background: transparent; color: var(--muted-foreground); text-decoration: line-through; }
	.stage-chip:disabled { opacity: 0.6; cursor: default; }
	.stage-picks { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: var(--sp-2) var(--sp-3); display: flex; flex-wrap: wrap; gap: var(--sp-2) var(--sp-4); font-size: 13px; }
	.stage-picks legend { font-size: 13px; font-weight: 500; padding: 0 var(--sp-1); }
	.stage-picks input { accent-color: var(--primary); }
	.dl-amount { display: flex; align-items: center; gap: 4px; margin-top: 4px; font-size: 12px; color: var(--muted-foreground); }
	.empty { text-align: center; color: var(--muted-foreground); padding: var(--sp-6); }
	.add-member h3 { margin-bottom: var(--sp-1); }
	.impact { border: 1px solid var(--tertiary); background: var(--tertiary-subtle); color: var(--tertiary-foreground); border-radius: var(--radius); padding: var(--sp-4); display: flex; flex-direction: column; gap: var(--sp-2); font-size: 13px; }
	.impact p { margin: 0; }
	.impact-list { margin: 0; padding-left: var(--sp-5); display: flex; flex-direction: column; gap: 2px; }
	.impact-list .warn { color: var(--danger); }

	.tpl-save { display: grid; grid-template-columns: 1fr auto; gap: var(--sp-2) var(--sp-3); align-items: end; }
	.tpl-save .hint, .tpl-save .notice { grid-column: 1 / -1; margin: 0; }
	.form-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: var(--sp-3); }
	.form-foot .notice { margin: 0 auto 0 0; }

	.table-wrap { overflow-x: auto; }
	table { width: 100%; border-collapse: collapse; font-size: 13px; }
	thead th { text-align: left; font-size: 12px; font-weight: 600; color: var(--muted-foreground); padding: var(--sp-2) var(--sp-2); border-bottom: 1px solid var(--border); }
	.group-row th { text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted-foreground); padding: var(--sp-4) var(--sp-2) var(--sp-1); }
	td { padding: var(--sp-2); border-bottom: 1px solid var(--border); vertical-align: middle; }
	td .input { width: 100%; min-width: 110px; padding: var(--sp-1) var(--sp-2); }
	td .input.cap, .cap { width: 80px; min-width: 0; }
	tr.dim td { opacity: 0.6; }
	tr.expand td { background: var(--muted); padding: var(--sp-3); }
	.num { text-align: right; }
	.right { text-align: right; }
	.n { font-weight: 400; }
	.name { font-weight: 600; display: flex; gap: var(--sp-2); align-items: center; }
	.muted { color: var(--muted-foreground); font-size: 12px; display: flex; gap: var(--sp-2); align-items: center; }
	.tag { font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 4px; background: var(--muted); color: var(--muted-foreground); }
	.actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--sp-2); }

	.status { font-size: 11px; font-weight: 500; padding: 0 6px; border-radius: 999px; }
	.status[data-status='active'] { background: var(--success-subtle); color: var(--success); }
	.status[data-status='invited'] { background: var(--secondary-subtle); color: var(--secondary-foreground); }
	.status[data-status='placeholder'] { background: var(--muted); color: var(--muted-foreground); }
	.status[data-status='deactivated'] { background: var(--danger-subtle); color: var(--danger); }

	.inline-form { flex-direction: row; flex-wrap: wrap; align-items: flex-end; gap: var(--sp-3); }
	.grow { flex: 1 1 200px; }

	.add-member { background: var(--muted); border-radius: var(--radius); padding: var(--sp-4); gap: var(--sp-3); }
	.add-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--sp-3); }
	.seg { display: flex; gap: var(--sp-4); font-size: 13px; }
	.seg input { accent-color: var(--primary); }
	.add-fields { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--sp-3); }
</style>
