<script lang="ts">
	import { untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { openTask } from '#lib/task-drawer.svelte.ts';
	import { latestEnd, sortWindows, windowAt } from '#lib/schedule/windows.ts';
	import { setHolidays } from '#lib/schedule/calendar.ts';
	import { criticalPath } from '#lib/schedule/critical.ts';
	import { statusLabel } from '#lib/status.ts';

	// ── Types ─────────────────────────────────────────────────────────────────

	type Series = {
		id: string;
		name: string;
		startDate: string;
		targetDate: string;
		hardLimitDate: string | null;
		enforceWindows: number;
		strictMode: number;
		windowOverflowDays: number;
	};
	type Stage = { id: string; key: string; name: string; category: string; ignoresWindows: number };
	type Book = {
		id: string;
		code: string;
		name: string;
		groupLabel: string | null;
		sortOrder: number;
	};
	type Task = {
		id: string;
		bookId: string;
		stageId: string;
		startDate: string;
		endDate: string;
		durationDays: number;
		status: string;
		title: string;
		iteration: number;
		version: number;
		windowId: string | null;
		scheduleState: 'scheduled' | 'unscheduled';
		overflowAllowed: number;
		statusBeforeBlock: string | null;
	};
	type Assignee = { taskId: string; personId: string; isLead: number };
	type Dep = { id: string; predecessorId: string; successorId: string; lagDays: number };
	type Window = {
		id: string;
		label: string;
		startDate: string;
		endDate: string;
		sortOrder: number;
	};
	type Person = { id: string; displayName: string };
	type Member = { personId: string; teamLabel: string | null; role: string };

	type Props = {
		series: Series;
		stages: Stage[];
		books: Book[];
		tasks: Task[];
		assignees: Assignee[];
		deps: Dep[];
		windows: Window[];
		people: Person[];
		members: Member[];
		today: string;
		holidays?: { date: string; label: string }[];
	};

	let {
		series,
		stages: stagesProp,
		books: booksProp,
		tasks: tasksProp,
		assignees,
		deps,
		windows: windowsProp,
		people: peopleProp,
		members,
		today,
		holidays: holidaysProp = []
	}: Props = $props();

	// The same working-day calendar as the server: holidays are not working days.
	$effect.pre(() => setHolidays(holidaysProp.map((h) => h.date)));
	const holidayName = $derived(new Map(holidaysProp.map((h) => [h.date, h.label])));

	// ── Constants ─────────────────────────────────────────────────────────────

	const LABEL_W = 160;
	const DAY_W = 40;
	const WKND_W = 8;
	const ROW_H = 40;
	const WIN_ROW = 26;
	const DAY_ROW = 28;
	const AXIS_H = WIN_ROW + DAY_ROW;

	const MONTHS = [
		'Jan',
		'Feb',
		'Mar',
		'Apr',
		'May',
		'Jun',
		'Jul',
		'Aug',
		'Sep',
		'Oct',
		'Nov',
		'Dec'
	];

	const WIN_COLORS = [
		'rgba(99,91,255,0.06)',
		'rgba(6,182,212,0.06)',
		'rgba(245,158,11,0.06)',
		'rgba(192,38,211,0.06)',
		'rgba(18,161,80,0.06)'
	];
	const WIN_BORDER_COLORS = [
		'rgba(99,91,255,0.25)',
		'rgba(6,182,212,0.25)',
		'rgba(245,158,11,0.25)',
		'rgba(192,38,211,0.25)',
		'rgba(18,161,80,0.25)'
	];

	// ── UI State ──────────────────────────────────────────────────────────────

	let laneMode = $state<'book' | 'person'>('book');
	let critPath = $state(false);

	// The toggle is remembered in this browser, and C switches it (spec: Projected dates).
	const CP_KEY = 'bookflow:criticalPath';
	$effect(() => {
		try { critPath = localStorage.getItem(CP_KEY) === '1'; } catch { /* storage unavailable */ }
	});
	function toggleCritPath() {
		critPath = !critPath;
		try { localStorage.setItem(CP_KEY, critPath ? '1' : '0'); } catch { /* storage unavailable */ }
	}
	function onKey(e: KeyboardEvent) {
		const el = e.target as HTMLElement | null;
		if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
		const key = e.key.toLowerCase();
		// Ctrl or Cmd + Z undoes, with Shift redoes (Ctrl + Y too) — spec: Undo and redo.
		if ((e.ctrlKey || e.metaKey) && !e.altKey && (key === 'z' || (key === 'y' && !e.shiftKey))) {
			e.preventDefault();
			step(key === 'y' || e.shiftKey ? 'redo' : 'undo');
			return;
		}
		if (key !== 'c' || e.ctrlKey || e.metaKey || e.altKey) return;
		toggleCritPath();
	}

	// ── Undo and redo ─────────────────────────────────────────────────────────
	// The server keeps the stack: each person's last 50 changes on the series, newest first.

	type StackItem = { batchId: string; label: string } | null;
	let stack = $state<{ undo: StackItem; redo: StackItem }>({ undo: null, redo: null });
	let stepping = $state(false);

	async function refreshStack() {
		try {
			const res = await fetch(`/api/series/${series.id}/history`);
			if (res.ok) stack = await res.json();
		} catch { /* offline; buttons keep their last state */ }
	}
	$effect(() => {
		void series.id;
		untrack(refreshStack);
	});

	async function step(which: 'undo' | 'redo') {
		const item = stack[which];
		if (!item || stepping || drag || resizing) return;
		stepping = true;
		try {
			const res = await fetch(`/api/${which}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ batchId: item.batchId, seriesId: series.id })
			});
			const body = await res.json().catch(() => ({}));
			if (res.ok) {
				showNotice(`${which === 'undo' ? 'Undone' : 'Redone'}: ${item.label}`, 'ok');
				await invalidateAll();
			} else {
				showNotice(body.message ?? `That could not be ${which === 'undo' ? 'undone' : 'redone'}.`);
			}
		} catch {
			showNotice('Could not reach the server. Nothing was changed.');
		} finally {
			stepping = false;
			await refreshStack();
		}
	}
	// Editable local copy; synced from prop via effect declared after drag/resize state
	let localTasks = $state<Task[]>([]);

	// ── Lookup maps ───────────────────────────────────────────────────────────

	const stageMap = $derived(new Map(stagesProp.map((s) => [s.id, s])));
	const bookMap = $derived(new Map(booksProp.map((b) => [b.id, b])));
	const personMap = $derived(new Map(peopleProp.map((p) => [p.id, p])));

	// lead assignee per task (isLead=1 wins; fallback to first)
	const leadMap = $derived.by(() => {
		const m = new Map<string, string>();
		for (const a of assignees) {
			if (!m.has(a.taskId) || a.isLead) m.set(a.taskId, a.personId);
		}
		return m;
	});

	// ── Calendar ──────────────────────────────────────────────────────────────

	function addCalDays(date: string, n: number): string {
		const d = new Date(date + 'T12:00:00Z');
		d.setUTCDate(d.getUTCDate() + n);
		return d.toISOString().slice(0, 10);
	}

	// isWeekend means "not a working day": weekends and holidays share the narrow column.
	type CalDay = { date: string; isWeekend: boolean; dayNum: number; monthLabel: string | null };

	// Two weeks past the target (spec), extended to the hard limit, the last window and
	// the last task: anything outside the axis would have no x position.
	const axisEnd = $derived(
		[
			addCalDays(series.targetDate, 14),
			series.hardLimitDate ?? '',
			...windowsProp.map((w) => w.endDate),
			...localTasks.map((t) => t.endDate)
		].reduce((a, b) => (b > a ? b : a))
	);

	const calDays = $derived.by((): CalDay[] => {
		const end = axisEnd;
		const days: CalDay[] = [];
		const d = new Date(series.startDate + 'T12:00:00Z');
		const e = new Date(end + 'T12:00:00Z');
		let prevMonth = -1;
		while (d <= e) {
			const dow = d.getUTCDay();
			const mon = d.getUTCMonth();
			days.push({
				date: d.toISOString().slice(0, 10),
				isWeekend: dow === 0 || dow === 6 || holidayName.has(d.toISOString().slice(0, 10)),
				dayNum: d.getUTCDate(),
				monthLabel: mon !== prevMonth ? MONTHS[mon] : null
			});
			prevMonth = mon;
			d.setUTCDate(d.getUTCDate() + 1);
		}
		return days;
	});

	// X positions: date → left-edge px offset
	const { dateX, totalW } = $derived.by(() => {
		const m = new Map<string, number>();
		let x = 0;
		for (const day of calDays) {
			m.set(day.date, x);
			x += day.isWeekend ? WKND_W : DAY_W;
		}
		return { dateX: m, totalW: x };
	});

	const workingDays = $derived(calDays.filter((d) => !d.isWeekend));

	// ── Window rules (shared with the server: #lib/schedule) ────────────────────

	const sortedWins = $derived(sortWindows(windowsProp));
	const winById = $derived(new Map(windowsProp.map((w) => [w.id, w])));

	const STARTED = ['in_progress', 'in_review', 'returned'];
	function isStarted(t: Task) {
		return t.status === 'done' || STARTED.includes(t.status) ||
			(t.status === 'blocked' && !!t.statusBeforeBlock && STARTED.includes(t.statusBeforeBlock));
	}

	/** Window rules apply: enforced series, windowed stage, not a gate. */
	function isWindowed(t: Task) {
		return !!series.enforceWindows && !stageMap.get(t.stageId)?.ignoresWindows && t.durationDays > 0;
	}

	/** Latest end allowed for a task starting on `start`, or null when no window holds that date. */
	function allowedEnd(start: string, overflow: boolean): string | null {
		const w = windowAt(start, sortedWins);
		return w ? latestEnd(w, sortedWins, overflow ? series.windowOverflowDays : 0) : null;
	}

	function fits(t: Task, start: string, end: string, overflow = !!t.overflowAllowed) {
		if (!isWindowed(t)) return true;
		const limit = allowedEnd(start, overflow);
		return !!limit && end <= limit;
	}

	function countWorkingDays(afterDate: string, uptoDate: string) {
		return workingDays.filter((d) => d.date > afterDate && d.date <= uptoDate).length;
	}

	/** The part of a bar past its window's edge: drawn faded, with a "+Nd" badge. */
	function overflowOf(t: Task): { edgeX: number; days: number } | null {
		if (!isWindowed(t) || t.scheduleState === 'unscheduled') return null;
		const w = (t.windowId && winById.get(t.windowId)) || windowAt(t.startDate, sortedWins);
		if (!w || t.endDate <= w.endDate) return null;
		return { edgeX: (dateX.get(w.endDate) ?? 0) + DAY_W, days: countWorkingDays(w.endDate, t.endDate) };
	}

	/** Started task that no longer fits its window after a window change. */
	function isOutsideWindow(t: Task) {
		return t.status !== 'done' && isStarted(t) && isWindowed(t) && t.scheduleState === 'scheduled' && !fits(t, t.startDate, t.endDate);
	}

	// Snap x-coord to nearest working-day left edge
	function snapX(x: number): string | null {
		let best: string | null = null;
		let bestDist = Infinity;
		for (const day of workingDays) {
			const dx = dateX.get(day.date) ?? 0;
			const dist = Math.abs(x - dx);
			if (dist < bestDist) {
				bestDist = dist;
				best = day.date;
			}
		}
		return best;
	}

	// ── Lanes ─────────────────────────────────────────────────────────────────

	type Lane = { id: string; label: string; sublabel?: string; groupLabel?: string; tasks: Task[]; overflow?: boolean };

	// Unscheduled tasks (no window had room) are parked in an overflow lane at the bottom.
	const unscheduled = $derived(localTasks.filter((t) => t.scheduleState === 'unscheduled'));

	const lanes = $derived.by((): Lane[] => {
		const placed = localTasks.filter((t) => t.scheduleState !== 'unscheduled');
		const main: Lane[] = laneMode === 'book'
			? booksProp.map((b) => ({
				id: b.id,
				label: b.code,
				sublabel: b.name,
				groupLabel: b.groupLabel ?? undefined,
				tasks: placed.filter((t) => t.bookId === b.id)
			}))
			// By person: sort by teamLabel, then displayName
			: [...members]
				.sort((a, b) => (a.teamLabel ?? '').localeCompare(b.teamLabel ?? ''))
				.map((m) => {
					const person = personMap.get(m.personId);
					return {
						id: m.personId,
						label: person?.displayName ?? m.personId,
						groupLabel: m.teamLabel ?? undefined,
						tasks: placed.filter((t) => leadMap.get(t.id) === m.personId)
					};
				});
		if (!unscheduled.length) return main;
		return [...main, {
			id: '__unscheduled',
			label: 'Unscheduled',
			sublabel: `${unscheduled.length} waiting for a window`,
			groupLabel: 'Overflow lane',
			tasks: unscheduled,
			overflow: true
		}];
	});

	// ── Lane layout ───────────────────────────────────────────────────────────
	// Tasks in one lane that overlap in time (e.g. image generation and image review
	// running together) are stacked into sub-rows, and the lane grows to fit. Every
	// vertical position (bars, arrows, background) comes from this one calculation,
	// group header rows included.

	const GRP_H = 22;
	type LaneBox = { top: number; height: number; header: string | null; sub: Map<string, number> };

	const layout = $derived.by(() => {
		const boxes: LaneBox[] = [];
		const centerY = new Map<string, number>();
		let y = 0;
		lanes.forEach((lane, i) => {
			const header = showGroupHeader(i);
			if (header) y += GRP_H;
			const rowEnds: string[] = []; // last end date in each sub-row
			const sub = new Map<string, number>();
			const ordered = [...lane.tasks].sort((a, b) => a.startDate.localeCompare(b.startDate) || b.durationDays - a.durationDays);
			for (const t of ordered) {
				let r = rowEnds.findIndex((end) => end < t.startDate);
				if (r < 0) r = rowEnds.push(t.endDate) - 1;
				else rowEnds[r] = t.endDate;
				sub.set(t.id, r);
				centerY.set(t.id, y + r * ROW_H + ROW_H / 2);
			}
			const height = Math.max(1, rowEnds.length) * ROW_H;
			boxes.push({ top: y, height, header, sub });
			y += height;
		});
		return { boxes, centerY, totalH: y };
	});

	// ── Bar geometry ──────────────────────────────────────────────────────────

	function barLeft(t: Task) {
		return dateX.get(t.startDate) ?? 0;
	}
	function barRight(t: Task) {
		return (dateX.get(t.endDate) ?? 0) + DAY_W;
	}
	function barWidth(t: Task) {
		return Math.max(barRight(t) - barLeft(t), DAY_W);
	}

	// ── Dependency arrows ─────────────────────────────────────────────────────

	// Critical path: tasks that cannot slip without delaying the series' projected finish
	// (the latest binding). Recomputed as bars move, so a drag shows its effect at once.
	const critical = $derived(
		criticalPath(localTasks, deps, localTasks.filter((t) => stageMap.get(t.stageId)?.key === 'binding').map((t) => t.id))
	);

	// Arrows are hidden by default to keep the chart readable. A task's arrows show while
	// it is hovered, focused, dragged or resized; arrows flagging a violation always show.

	type Arrow = { key: string; x1: number; y1: number; x2: number; y2: number; violated: boolean };

	let hoverId = $state<string | null>(null);

	const arrows = $derived.by((): Arrow[] => {
		const focusId = drag?.taskId ?? resizing?.taskId ?? hoverId;
		const onPath = (a: string, b: string) => critPath && critical.has(a) && critical.has(b);
		return deps.flatMap((dep) => {
			const pred = localTasks.find((t) => t.id === dep.predecessorId);
			const succ = localTasks.find((t) => t.id === dep.successorId);
			if (!pred || !succ) return [];
			const y1 = layout.centerY.get(pred.id);
			const y2 = layout.centerY.get(succ.id);
			if (y1 === undefined || y2 === undefined) return [];
			// A task's successor starts the working day after it ends; a gate's may start the same day.
			const violated = pred.durationDays === 0 ? succ.startDate < pred.endDate : succ.startDate <= pred.endDate;
			if (!violated && focusId !== pred.id && focusId !== succ.id && !onPath(pred.id, succ.id)) return [];
			return [{ key: dep.id, x1: barRight(pred), y1, x2: barLeft(succ), y2, violated }];
		});
	});

	// ── Today / target X ─────────────────────────────────────────────────────

	const todayX = $derived(dateX.get(today));
	const targetX = $derived(dateX.get(series.targetDate));

	// ── Drag ─────────────────────────────────────────────────────────────────

	type DragState = {
		taskId: string;
		/** Pointer position at press, to tell a click (opens the drawer) from a drag. */
		downX: number;
		downY: number;
		travelled: boolean;
		origStart: string;
		origEnd: string;
		durationDays: number;
		startWdIdx: number;
		offsetX: number;
	};
	let drag: DragState | null = $state(null);
	let outerEl: HTMLElement | undefined = $state();

	// Message from the server when a save is refused (window rule, stale version).
	let notice = $state<string | null>(null);
	let noticeKind = $state<'error' | 'ok'>('error');
	let noticeTimer: ReturnType<typeof setTimeout> | undefined;
	function showNotice(text: string, kind: 'error' | 'ok' = 'error') {
		notice = text;
		noticeKind = kind;
		clearTimeout(noticeTimer);
		noticeTimer = setTimeout(() => (notice = null), 5000);
	}

	function clientToCanvasX(clientX: number): number {
		if (!outerEl) return 0;
		const rect = outerEl.getBoundingClientRect();
		return clientX - rect.left + outerEl.scrollLeft - LABEL_W;
	}

	function onBarDown(e: PointerEvent, task: Task) {
		e.preventDefault();
		const cx = clientToCanvasX(e.clientX);
		const startWdIdx = workingDays.findIndex((d) => d.date === task.startDate);
		drag = {
			taskId: task.id,
			downX: e.clientX,
			downY: e.clientY,
			travelled: false,
			origStart: task.startDate,
			origEnd: task.endDate,
			durationDays: task.durationDays,
			startWdIdx: startWdIdx >= 0 ? startWdIdx : 0,
			offsetX: cx - barLeft(task)
		};
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onPointerMove(e: PointerEvent) {
		if (!drag) return;
		if (Math.abs(e.clientX - drag.downX) + Math.abs(e.clientY - drag.downY) > 4) drag.travelled = true;
		const cx = clientToCanvasX(e.clientX) - drag.offsetX;
		const snapped = snapX(cx);
		if (!snapped) return;
		const sIdx = workingDays.findIndex((d) => d.date === snapped);
		if (sIdx < 0) return;
		const eIdx = sIdx + drag.durationDays - 1;
		if (eIdx >= workingDays.length) return;
		const newStart = workingDays[sIdx].date;
		const newEnd = workingDays[eIdx].date;
		const t = localTasks.find((x) => x.id === drag!.taskId);
		// The bar moves within its window, or into another one, but cannot straddle an
		// edge beyond its overflow allowance: positions that don't fit are skipped.
		if (!t || !fits(t, newStart, newEnd)) return;
		localTasks = localTasks.map((x) =>
			x.id === drag!.taskId ? { ...x, startDate: newStart, endDate: newEnd } : x
		);
	}

	type Orig = { startDate: string; endDate: string; durationDays: number };

	function revert(taskId: string, orig: Orig) {
		localTasks = localTasks.map((t) => (t.id === taskId ? { ...t, ...orig } : t));
	}

	/** Save a move or resize; merge the moved task and everything it pushed, or revert. */
	async function saveSchedule(taskId: string, orig: Orig) {
		const moved = localTasks.find((t) => t.id === taskId);
		if (!moved) return;
		try {
			const res = await fetch(`/api/tasks/${taskId}/schedule`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					start: moved.startDate,
					durationDays: moved.durationDays,
					version: moved.version
				})
			});
			const body = await res.json().catch(() => ({}));
			if (res.ok) {
				const changed = body.changed as Partial<Task>[];
				// Merge server response (includes propagated tasks)
				localTasks = localTasks.map((t) => {
					const sv = changed.find((c) => c.id === t.id);
					return sv ? { ...t, ...sv } : t;
				});
				refreshStack();
			} else {
				// Window violation (422) or version conflict (409): revert and say why
				revert(taskId, orig);
				showNotice(body.message ?? (res.status === 409 ? 'Someone else changed this task. Reload to see it.' : 'That change could not be saved.'));
			}
		} catch {
			// Network error: revert
			revert(taskId, orig);
			showNotice('Could not reach the server. The change was not saved.');
		}
	}

	async function onPointerUp() {
		if (!drag) return;
		const d = drag;
		drag = null; // clear immediately so $effect re-sync doesn't fire mid-save

		const moved = localTasks.find((t) => t.id === d.taskId);
		// A press without a drag is a click: open the task drawer (spec: Task drawer).
		if (!d.travelled) return openTask(d.taskId);
		if (!moved || (moved.startDate === d.origStart && moved.endDate === d.origEnd)) return;
		await saveSchedule(d.taskId, { startDate: d.origStart, endDate: d.origEnd, durationDays: d.durationDays });
	}

	// ── Resize ────────────────────────────────────────────────────────────────

	type ResizeState = { taskId: string; edge: 'left' | 'right'; origStart: string; origEnd: string; origDuration: number };
	let resizing: ResizeState | null = $state(null);

	// Pulling an ordinary task past its window's edge asks whether to allow overflow for it.
	let overflowAsk = $state<{ task: Task; orig: Orig; days: number; windowLabel: string } | null>(null);

	// Re-sync local tasks when the server sends new data (e.g. a reload), unless an edit is
	// in progress. Only the prop is tracked: finishing a drag must not reset the bars to
	// the dates loaded with the page.
	$effect(() => {
		const fresh = tasksProp;
		untrack(() => {
			if (!drag && !resizing && !overflowAsk) localTasks = [...fresh];
		});
	});

	// Poll for other users' changes every 10 seconds
	let pollCursor = $state('0');
	$effect(() => {
		const sid = series.id;
		const interval = setInterval(async () => {
			if (drag || resizing) return; // skip while editing
			try {
				const res = await fetch(`/api/series/${sid}/changes?since=${pollCursor}`);
				if (!res.ok) return;
				const { tasks: changed, cursor } = (await res.json()) as { tasks: Task[]; cursor: string };
				if (cursor !== pollCursor) pollCursor = cursor;
				if (changed.length > 0) {
					localTasks = localTasks.map((t) => {
						const sv = changed.find((c: Task) => c.id === t.id);
						return sv ? { ...t, ...sv } : t;
					});
				}
			} catch {
				/* network error, retry next tick */
			}
		}, 10_000);
		return () => clearInterval(interval);
	});

	function onEdgeDown(e: PointerEvent, task: Task, edge: 'left' | 'right') {
		e.stopPropagation();
		e.preventDefault();
		resizing = { taskId: task.id, edge, origStart: task.startDate, origEnd: task.endDate, origDuration: task.durationDays };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onEdgeMove(e: PointerEvent) {
		if (!resizing) return;
		const cx = clientToCanvasX(e.clientX);
		// A bar's right edge sits one day-width after its end date's left edge.
		const snapped = snapX(resizing.edge === 'right' ? cx - DAY_W : cx);
		if (!snapped) return;
		// Up to the window's edge, or into the next window as far as the series' overflow
		// allowance; an ordinary task is asked about overflow when released past the edge.
		const mayOverflow = series.windowOverflowDays > 0;
		localTasks = localTasks.map((t) => {
			if (t.id !== resizing!.taskId) return t;
			if (resizing!.edge === 'left') {
				if (snapped >= t.endDate || !fits(t, snapped, t.endDate, mayOverflow)) return t;
				const dur =
					workingDays.findIndex((d) => d.date === t.endDate) -
					workingDays.findIndex((d) => d.date === snapped) +
					1;
				return { ...t, startDate: snapped, durationDays: Math.max(1, dur) };
			} else {
				if (snapped < t.startDate || !fits(t, t.startDate, snapped, mayOverflow)) return t;
				const dur =
					workingDays.findIndex((d) => d.date === snapped) -
					workingDays.findIndex((d) => d.date === t.startDate) +
					1;
				return { ...t, endDate: snapped, durationDays: Math.max(1, dur) };
			}
		});
	}

	async function onEdgeUp() {
		if (!resizing) return;
		const r = resizing;
		resizing = null;

		const moved = localTasks.find((t) => t.id === r.taskId);
		if (!moved || (moved.startDate === r.origStart && moved.endDate === r.origEnd)) return;
		const orig = { startDate: r.origStart, endDate: r.origEnd, durationDays: r.origDuration };

		const w = isWindowed(moved) ? windowAt(moved.startDate, sortedWins) : null;
		if (w && !moved.overflowAllowed && moved.endDate > w.endDate) {
			overflowAsk = { task: moved, orig, days: countWorkingDays(w.endDate, moved.endDate), windowLabel: (w as Window).label };
			return;
		}
		await saveSchedule(r.taskId, orig);
	}

	async function allowOverflow() {
		if (!overflowAsk) return;
		const { task, orig } = overflowAsk;
		try {
			const res = await fetch(`/api/tasks/${task.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ overflowAllowed: true, version: task.version })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				overflowAsk = null;
				revert(task.id, orig);
				return showNotice(body.message ?? 'Could not allow overflow for this task.');
			}
			localTasks = localTasks.map((t) =>
				t.id === task.id ? { ...t, overflowAllowed: 1, version: body.task.version } : t
			);
			overflowAsk = null;
			await saveSchedule(task.id, orig);
		} catch {
			overflowAsk = null;
			revert(task.id, orig);
			showNotice('Could not reach the server. The change was not saved.');
		}
	}

	function cancelOverflow() {
		if (!overflowAsk) return;
		revert(overflowAsk.task.id, overflowAsk.orig);
		overflowAsk = null;
	}

	// ── Helpers ───────────────────────────────────────────────────────────────

	function catCls(cat: string) {
		return `cat-${cat}`;
	}

	function statusCls(s: string) {
		return `st-${s.replace('_', '-')}`;
	}

	// Hover text for a bar or gate: stage · book · status, then any schedule warnings.
	function tooltip(task: Task, notes: (string | false | undefined)[] = []) {
		const status = task.status === 'blocked' && task.statusBeforeBlock
			? `Blocked (was ${statusLabel(task.statusBeforeBlock)})`
			: statusLabel(task.status);
		const parts = [stageMap.get(task.stageId)?.name ?? '', bookMap.get(task.bookId)?.code ?? '', status, ...notes];
		return parts.filter(Boolean).join(' · ');
	}

	function arrow(x1: number, y1: number, x2: number, y2: number): string {
		const cx = (x2 - x1) * 0.45;
		return `M ${x1} ${y1} C ${x1 + cx} ${y1} ${x2 - cx} ${y2} ${x2} ${y2}`;
	}

	// ── Group change detection for lane labels ────────────────────────────────

	function showGroupHeader(i: number): string | null {
		if (!lanes[i].groupLabel) return null;
		if (i === 0) return lanes[i].groupLabel ?? null;
		if (lanes[i].groupLabel !== lanes[i - 1].groupLabel) return lanes[i].groupLabel ?? null;
		return null;
	}
</script>

<svelte:window onkeydown={onKey} />

<div class="sl-root">
	<!-- Toolbar -->
	<div class="sl-toolbar">
		<span class="sl-series-name">{series.name}</span>
		<div class="sl-toolbar-actions">
			<div class="btn-seg" data-tour="undo-redo" role="group" aria-label="Undo and redo">
				<button
					onclick={() => step('undo')}
					disabled={!stack.undo || stepping}
					title={stack.undo ? `Undo: ${stack.undo.label} (Ctrl+Z)` : 'Nothing to undo'}
				>Undo</button>
				<button
					onclick={() => step('redo')}
					disabled={!stack.redo || stepping}
					title={stack.redo ? `Redo: ${stack.redo.label} (Ctrl+Shift+Z)` : 'Nothing to redo'}
				>Redo</button>
			</div>
			<div class="btn-seg">
				<button class:on={laneMode === 'book'} onclick={() => (laneMode = 'book')}>By book</button>
				<button class:on={laneMode === 'person'} onclick={() => (laneMode = 'person')}
					>By person</button
				>
			</div>
			<button
				class="btn-toggle" data-tour="critical-path"
				class:on={critPath}
				onclick={toggleCritPath}
				aria-pressed={critPath}
				title="Outline the tasks that cannot slip without delaying the finish (shortcut: C)"
			>
				Critical path
			</button>
			{#if series.strictMode}
				<span class="badge-strict">Strict</span>
			{/if}
		</div>
	</div>

	{#if notice}
		<div class="sl-notice" class:ok={noticeKind === 'ok'} role={noticeKind === 'ok' ? 'status' : 'alert'}>
			<span>{notice}</span>
			<button onclick={() => (notice = null)} aria-label="Dismiss">×</button>
		</div>
	{/if}

	{#if overflowAsk}
		{@const st = stageMap.get(overflowAsk.task.stageId)}
		<div class="sl-ask" role="alertdialog" aria-label="Allow overflow">
			<p>
				<strong>{st?.name ?? 'This task'} · {bookMap.get(overflowAsk.task.bookId)?.code ?? ''}</strong>
				would run {overflowAsk.days} working {overflowAsk.days === 1 ? 'day' : 'days'} past
				"{overflowAsk.windowLabel}". Allow it to overflow? It still belongs to that window.
			</p>
			<div class="sl-ask-actions">
				<button class="btn-toggle" onclick={cancelOverflow}>Cancel</button>
				<button class="btn-toggle on" onclick={allowOverflow}>Allow overflow</button>
			</div>
		</div>
	{/if}

	<!-- Scrollable canvas -->
	<div
		class="sl-outer"
		bind:this={outerEl}
		data-tour="swimlane-canvas"
		role="presentation"
		onpointermove={resizing ? onEdgeMove : onPointerMove}
		onpointerup={resizing ? onEdgeUp : onPointerUp}
	>
		<!-- Sticky header: corner + time axis -->
		<div class="sl-head">
			<div class="sl-corner" style="width:{LABEL_W}px;height:{AXIS_H}px"></div>
			<div class="sl-axis" style="width:{totalW}px;height:{AXIS_H}px">
				<!-- Window label row -->
				{#each windowsProp as win, wi}
					{@const wx = dateX.get(win.startDate) ?? 0}
					{@const wx2 = (dateX.get(win.endDate) ?? 0) + DAY_W}
					<div
						class="sl-win-band"
						title={win.label}
						style="left:{wx}px;width:{wx2 - wx}px;height:{WIN_ROW}px;background:{WIN_COLORS[
							wi % WIN_COLORS.length
						]};border-color:{WIN_BORDER_COLORS[wi % WIN_BORDER_COLORS.length]}"
					>
						{win.label}
					</div>
				{/each}

				<!-- Day label row -->
				{#each calDays as day}
					{#if !day.isWeekend}
						{@const dx = dateX.get(day.date) ?? 0}
						<div
							class="sl-day-cell"
							style="left:{dx}px;width:{DAY_W}px;top:{WIN_ROW}px;height:{DAY_ROW}px"
						>
							{#if day.monthLabel}
								<span class="sl-mon">{day.monthLabel}</span>
							{/if}
							{day.dayNum}
						</div>
					{/if}
				{/each}

				<!-- Today & target markers in header -->
				{#if todayX !== undefined}
					<div class="sl-today-head" style="left:{todayX + DAY_W / 2}px;height:{AXIS_H}px"></div>
				{/if}
				{#if targetX !== undefined}
					<div class="sl-target-head" style="left:{targetX + DAY_W / 2}px;height:{AXIS_H}px"></div>
				{/if}
			</div>
		</div>

		<!-- Lanes body -->
		<div class="sl-body" style="min-width:{LABEL_W + totalW}px">
			<!-- Background grid (weekend cols + window dividers + today/target lines) -->
			<div class="sl-bg" style="left:{LABEL_W}px;width:{totalW}px;height:{layout.totalH}px">
				{#each calDays as day}
					{#if day.isWeekend}
						<div class="sl-wknd" class:sl-holiday={holidayName.has(day.date)} title={holidayName.get(day.date)}
							style="left:{dateX.get(day.date) ?? 0}px;width:{WKND_W}px"></div>
					{/if}
				{/each}
				{#each windowsProp as win, wi}
					{@const wx = dateX.get(win.startDate) ?? 0}
					{@const wx2 = (dateX.get(win.endDate) ?? 0) + DAY_W}
					<div
						class="sl-win-bg"
						style="left:{wx}px;width:{wx2 - wx}px;border-color:{WIN_BORDER_COLORS[
							wi % WIN_BORDER_COLORS.length
						]}"
					></div>
				{/each}
				{#if todayX !== undefined}
					<div class="sl-today-line" style="left:{todayX + DAY_W / 2}px"></div>
				{/if}
				{#if targetX !== undefined}
					<div class="sl-target-line" style="left:{targetX + DAY_W / 2}px"></div>
				{/if}
			</div>

			<!-- SVG arrows overlay -->
			<svg
				class="sl-arrows"
				style="left:{LABEL_W}px;width:{totalW}px;height:{layout.totalH}px"
			>
				<defs>
					<marker id="ah" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
						<path d="M 0 0 L 6 3 L 0 6 Z" fill="var(--muted-foreground)" />
					</marker>
					<marker id="ah-v" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
						<path d="M 0 0 L 6 3 L 0 6 Z" fill="var(--danger)" />
					</marker>
				</defs>
				{#each arrows as a (a.key)}
					<path
						d={arrow(a.x1, a.y1, a.x2, a.y2)}
						fill="none"
						stroke={a.violated ? 'var(--danger)' : 'var(--muted-foreground)'}
						stroke-width="1.5"
						marker-end={a.violated ? 'url(#ah-v)' : 'url(#ah)'}
						opacity={critPath ? 0.25 : 0.7}
					/>
				{/each}
			</svg>

			<!-- Lane rows -->
			{#each lanes as lane, li}
				{@const grpHdr = showGroupHeader(li)}
				{#if grpHdr}
					<div class="sl-grp-hdr" style="padding-left:{LABEL_W + 8}px">{grpHdr}</div>
				{/if}
				{@const box = layout.boxes[li]}
				<div class="sl-lane" style="height:{box.height}px">
					<!-- Sticky label -->
					<div class="sl-label">
						{#if laneMode === 'book' && !lane.overflow}
							<a class="sl-label-code" href="/s/{series.id}/books/{encodeURIComponent(lane.label)}">{lane.label}</a>
						{:else}
							<span class="sl-label-code">{lane.label}</span>
						{/if}
						{#if lane.sublabel && laneMode === 'book'}
							<span class="sl-label-name">{lane.sublabel}</span>
						{/if}
					</div>
					<!-- Task bars -->
					<div class="sl-canvas" style="width:{totalW}px">
						{#each lane.tasks as task}
							{@const stage = stageMap.get(task.stageId)}
							{@const bx = barLeft(task)}
							{@const rowTop = (box.sub.get(task.id) ?? 0) * ROW_H}
							{@const bw = barWidth(task)}
							{@const isGate = stage?.category === 'gate'}
							{@const isCritical = critPath && critical.has(task.id)}
							{@const isCpFaded = critPath && !isCritical}

							{#if isGate}
								<!-- Diamond marker -->
								<div
									class="sl-gate"
									style="left:{bx + DAY_W / 2 - 9}px;top:{rowTop + ROW_H / 2 - 9}px"
									title={tooltip(task)}
									class:cp-dim={isCpFaded}
									class:cp-on={isCritical}
								></div>
							{:else}
								{@const ovf = overflowOf(task)}
								{@const outside = isOutsideWindow(task)}
								<div
									class="sl-bar {catCls(stage?.category ?? 'creation')} {statusCls(task.status)}"
									class:cp-dim={isCpFaded}
									class:cp-on={isCritical}
									class:sl-bar--outside={outside}
									class:sl-bar--unscheduled={lane.overflow}
									style="left:{bx}px;width:{bw}px;top:{rowTop + 4}px;height:{ROW_H - 8}px"
									onpointerdown={(e) => onBarDown(e, task)}
									onpointerenter={() => (hoverId = task.id)}
									onpointerleave={() => hoverId === task.id && (hoverId = null)}
									onfocus={() => (hoverId = task.id)}
									onblur={() => hoverId === task.id && (hoverId = null)}
									role="button"
									tabindex="0"
									onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), openTask(task.id))}
									title={tooltip(task, [
										!!ovf && `overflows ${ovf.days} working day${ovf.days === 1 ? '' : 's'}`,
										outside && 'Outside window',
										lane.overflow && 'Unscheduled: no window has room'
									])}
								>
									{#if ovf}
										<!-- The part past the window edge: faded, behind a dashed edge -->
										<span class="sl-ovf" style="left:{ovf.edgeX - bx}px"><b>+{ovf.days}d</b></span>
									{/if}
									<!-- Resize handles -->
									<span
										class="sl-edge sl-edge--l"
										onpointerdown={(e) => onEdgeDown(e, task, 'left')}
										role="presentation"
									></span>
									<span class="sl-bar-lbl">
										{stage?.name ?? ''}
										{#if task.iteration > 1}<em>×{task.iteration}</em>{/if}
										{#if lane.overflow}<em>· {bookMap.get(task.bookId)?.code ?? ''}</em>{/if}
										{#if outside}<em class="sl-flag">Outside window</em>{/if}
									</span>
									<span
										class="sl-edge sl-edge--r"
										onpointerdown={(e) => onEdgeDown(e, task, 'right')}
										role="presentation"
									></span>
								</div>
							{/if}
						{/each}
					</div>
				</div>
			{/each}
		</div>
	</div>
</div>

<style>
	/* ── Root ─────────────────────────────────────────────────────────────────── */
	.sl-root {
		display: flex;
		flex-direction: column;
		height: calc(100vh - 48px);
		overflow: hidden;
		background: var(--background);
	}

	/* ── Toolbar ──────────────────────────────────────────────────────────────── */
	.sl-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 16px;
		height: 44px;
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
		gap: 12px;
	}
	.sl-series-name {
		font-weight: 600;
		font-size: 14px;
		color: var(--foreground);
	}
	.sl-toolbar-actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.btn-seg {
		display: flex;
		border: 1px solid var(--border);
		border-radius: 6px;
		overflow: hidden;
	}
	.btn-seg button {
		border: none;
		padding: 4px 10px;
		font-size: 12px;
		font-weight: 500;
		background: var(--background);
		color: var(--muted-foreground);
		cursor: pointer;
	}
	.btn-seg button.on {
		background: var(--primary-subtle);
		color: var(--primary);
	}
	.btn-seg button:disabled { opacity: 0.45; cursor: default; }
	.btn-seg button:not(:disabled):hover { color: var(--foreground); background: var(--muted); }
	.btn-seg button + button { border-left: 1px solid var(--border); }
	.btn-toggle {
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 4px 10px;
		font-size: 12px;
		font-weight: 500;
		background: var(--background);
		color: var(--muted-foreground);
		cursor: pointer;
	}
	.btn-toggle.on {
		background: var(--primary-subtle);
		color: var(--primary);
		border-color: transparent;
	}
	.badge-strict {
		display: inline-block;
		padding: 2px 7px;
		border-radius: 4px;
		background: var(--danger-subtle);
		color: var(--danger);
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	/* ── Outer scroll container ───────────────────────────────────────────────── */
	.sl-outer {
		flex: 1;
		overflow: auto;
		position: relative;
	}

	/* ── Sticky axis header ───────────────────────────────────────────────────── */
	.sl-head {
		display: flex;
		position: sticky;
		top: 0;
		z-index: 20;
		background: var(--background);
		border-bottom: 1px solid var(--border);
	}
	.sl-corner {
		position: sticky;
		left: 0;
		z-index: 30;
		background: var(--background);
		border-right: 1px solid var(--border);
		flex-shrink: 0;
	}
	.sl-axis {
		position: relative;
		flex-shrink: 0;
		overflow: visible;
	}
	.sl-win-band {
		position: absolute;
		top: 0;
		display: flex;
		align-items: center;
		padding-left: 6px;
		font-size: 10px;
		font-weight: 600;
		color: var(--muted-foreground);
		border-left: 2px solid;
		border-right: 2px solid;
		overflow: hidden;
		white-space: nowrap;
		letter-spacing: 0.02em;
	}
	.sl-day-cell {
		position: absolute;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-end;
		padding-bottom: 3px;
		font-size: 11px;
		color: var(--muted-foreground);
		font-variant-numeric: tabular-nums;
		border-left: 1px solid var(--border);
		gap: 0;
	}
	.sl-mon {
		font-size: 9px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		opacity: 0.7;
		line-height: 1;
	}
	.sl-today-head {
		position: absolute;
		top: 0;
		width: 2px;
		background: var(--primary);
		opacity: 0.5;
		pointer-events: none;
	}
	.sl-target-head {
		position: absolute;
		top: 0;
		width: 0;
		border-left: 2px dashed var(--tertiary);
		opacity: 0.7;
		pointer-events: none;
	}

	/* ── Body ─────────────────────────────────────────────────────────────────── */
	.sl-body {
		position: relative;
	}

	/* Group header rows */
	.sl-grp-hdr {
		height: 22px;
		line-height: 22px;
		font-size: 11px;
		font-weight: 700;
		color: var(--muted-foreground);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		background: var(--muted);
		border-bottom: 1px solid var(--border);
		position: sticky;
		left: 0;
	}

	/* Background absolute overlay */
	.sl-bg {
		position: absolute;
		top: 0;
		pointer-events: none;
	}
	.sl-holiday {
		background: var(--tertiary-subtle);
		pointer-events: auto;
	}
	.sl-wknd {
		position: absolute;
		top: 0;
		height: 100%;
		background: var(--weekend);
	}
	.sl-win-bg {
		position: absolute;
		top: 0;
		height: 100%;
		border-left: 1px solid;
		border-right: 1px solid;
		opacity: 0.4;
	}
	.sl-today-line {
		position: absolute;
		top: 0;
		height: 100%;
		width: 2px;
		background: var(--primary);
		opacity: 0.35;
	}
	.sl-target-line {
		position: absolute;
		top: 0;
		height: 100%;
		width: 0;
		border-left: 2px dashed var(--tertiary);
		opacity: 0.5;
	}

	/* SVG arrows */
	.sl-arrows {
		position: absolute;
		top: 0;
		pointer-events: none;
		overflow: visible;
		z-index: 4;
	}

	/* Lane rows */
	.sl-lane {
		display: flex;
		align-items: stretch;
		border-bottom: 1px solid var(--border);
		position: relative;
	}
	.sl-label {
		position: sticky;
		left: 0;
		z-index: 10;
		flex-shrink: 0;
		width: 160px;
		min-width: 160px;
		background: var(--background);
		border-right: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		justify-content: center;
		padding: 0 10px;
		gap: 1px;
	}
	.sl-label-code {
		font-size: 12px;
		font-weight: 600;
		color: var(--foreground);
	}
	.sl-label-name {
		font-size: 10px;
		color: var(--muted-foreground);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sl-canvas {
		position: relative;
		flex-shrink: 0;
		overflow: visible;
	}

	/* ── Bars ─────────────────────────────────────────────────────────────────── */
	.sl-bar {
		position: absolute;
		border-radius: 4px;
		display: flex;
		align-items: center;
		padding: 0 8px;
		overflow: hidden;
		white-space: nowrap;
		cursor: grab;
		user-select: none;
		z-index: 5;
		transition: opacity 0.15s;
	}
	.sl-bar:active {
		cursor: grabbing;
	}

	.sl-bar-lbl {
		font-size: 11px;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		pointer-events: none;
		flex: 1;
	}
	.sl-bar-lbl em {
		font-style: normal;
		opacity: 0.7;
		margin-left: 3px;
	}

	/* Window overflow: the part past the edge is faded behind a dashed line */
	.sl-ovf {
		position: absolute;
		top: 0;
		right: 0;
		height: 100%;
		border-left: 2px dashed currentColor;
		background: color-mix(in srgb, var(--background) 40%, transparent);
		display: flex;
		align-items: center;
		justify-content: flex-end;
		padding-right: 6px;
		pointer-events: none;
	}
	.sl-ovf b {
		font-size: 10px;
		font-weight: 700;
		background: var(--background);
		color: var(--foreground);
		border-radius: 3px;
		padding: 0 3px;
	}
	.sl-bar--outside {
		outline: 2px dashed var(--danger);
		outline-offset: 1px;
	}
	.sl-flag {
		color: var(--danger);
		font-weight: 700;
	}
	.sl-bar--unscheduled {
		background-image: repeating-linear-gradient(135deg, transparent 0 6px, rgba(0, 0, 0, 0.08) 6px 12px);
	}

	/* Messages and the overflow prompt */
	.sl-notice,
	.sl-ask {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 16px;
		font-size: 13px;
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
	}
	.sl-notice {
		background: var(--danger-subtle);
		color: var(--danger);
		justify-content: space-between;
	}
	.sl-notice.ok {
		background: var(--success-subtle);
		color: var(--success);
	}
	.sl-notice button {
		border: none;
		background: none;
		color: inherit;
		font-size: 16px;
		line-height: 1;
	}
	.sl-ask {
		background: var(--tertiary-subtle);
		color: var(--tertiary-foreground);
		justify-content: space-between;
		flex-wrap: wrap;
	}
	.sl-ask p {
		margin: 0;
	}
	.sl-ask-actions {
		display: flex;
		gap: 8px;
	}

	/* Resize edge handles */
	.sl-edge {
		position: absolute;
		top: 0;
		height: 100%;
		width: 6px;
		cursor: ew-resize;
		z-index: 6;
		border-radius: 2px;
	}
	.sl-edge--l {
		left: 0;
	}
	.sl-edge--r {
		right: 0;
	}
	.sl-edge:hover {
		background: rgba(0, 0, 0, 0.12);
	}

	/* Gate diamond */
	.sl-gate {
		position: absolute;
		width: 18px;
		height: 18px;
		border: 2px solid var(--muted-foreground);
		transform: rotate(45deg);
		background: var(--background);
		z-index: 5;
		cursor: pointer;
	}

	/* Critical-path dim */
	.cp-dim {
		opacity: 0.4;
	}
	.cp-on {
		outline: 2px solid var(--primary-active);
		outline-offset: 1px;
		z-index: 6;
	}

	/* ── Stage category fills ─────────────────────────────────────────────────── */
	.cat-creation {
		background: var(--primary-subtle);
		color: var(--primary-subtle-foreground);
	}
	.cat-review {
		background: var(--secondary-subtle);
		color: var(--secondary-foreground);
	}
	.cat-layout {
		background: var(--tertiary-subtle);
		color: var(--tertiary-foreground);
	}
	.cat-publish {
		background: var(--publish-subtle);
		color: var(--publish-foreground);
	}
	.cat-production {
		background: var(--production-subtle);
		color: var(--production);
	}

	/* ── Status style overlays ────────────────────────────────────────────────── */
	/* not_started: outline only */
	.st-not-started {
		background: transparent !important;
		border: 1.5px solid currentColor;
		opacity: 0.65;
	}
	/* in_progress: solid (default, no override needed) */

	/* in_review: diagonal stripe */
	.st-in-review {
		background-image: repeating-linear-gradient(
			-45deg,
			transparent,
			transparent 4px,
			rgba(0, 0, 0, 0.07) 4px,
			rgba(0, 0, 0, 0.07) 8px
		) !important;
	}

	/* returned: dashed border */
	.st-returned {
		border: 2px dashed currentColor !important;
		opacity: 0.85;
	}
	.st-returned::after {
		content: '↩';
		position: absolute;
		right: 6px;
		font-size: 12px;
		opacity: 0.7;
	}

	/* done: check + reduced opacity */
	.st-done {
		opacity: 0.45;
	}
	.st-done::after {
		content: '✓';
		position: absolute;
		right: 6px;
		font-size: 12px;
	}

	/* blocked: danger border */
	.st-blocked {
		box-shadow: inset 0 0 0 2px var(--danger) !important;
	}
</style>
