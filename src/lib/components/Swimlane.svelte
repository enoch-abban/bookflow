<script lang="ts">
	// ── Types ─────────────────────────────────────────────────────────────────

	type Series = {
		id: string;
		name: string;
		startDate: string;
		targetDate: string;
		hardLimitDate: string | null;
		enforceWindows: number;
		strictMode: number;
	};
	type Stage = { id: string; key: string; name: string; category: string };
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
		today
	}: Props = $props();

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

	type CalDay = { date: string; isWeekend: boolean; dayNum: number; monthLabel: string | null };

	const calDays = $derived.by((): CalDay[] => {
		const end = addCalDays(series.targetDate, 14);
		const days: CalDay[] = [];
		const d = new Date(series.startDate + 'T12:00:00Z');
		const e = new Date(end + 'T12:00:00Z');
		let prevMonth = -1;
		while (d <= e) {
			const dow = d.getUTCDay();
			const mon = d.getUTCMonth();
			days.push({
				date: d.toISOString().slice(0, 10),
				isWeekend: dow === 0 || dow === 6,
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

	type Lane = { id: string; label: string; sublabel?: string; groupLabel?: string; tasks: Task[] };

	const lanes = $derived.by((): Lane[] => {
		if (laneMode === 'book') {
			return booksProp.map((b) => ({
				id: b.id,
				label: b.code,
				sublabel: b.name,
				groupLabel: b.groupLabel ?? undefined,
				tasks: localTasks.filter((t) => t.bookId === b.id)
			}));
		}
		// By person: sort by teamLabel, then displayName
		return [...members]
			.sort((a, b) => (a.teamLabel ?? '').localeCompare(b.teamLabel ?? ''))
			.map((m) => {
				const person = personMap.get(m.personId);
				return {
					id: m.personId,
					label: person?.displayName ?? m.personId,
					groupLabel: m.teamLabel ?? undefined,
					tasks: localTasks.filter((t) => leadMap.get(t.id) === m.personId)
				};
			});
	});

	// task → lane row index (0-based)
	const taskRow = $derived.by(() => {
		const m = new Map<string, number>();
		lanes.forEach((lane, i) => {
			for (const t of lane.tasks) m.set(t.id, i);
		});
		return m;
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

	type Arrow = { x1: number; y1: number; x2: number; y2: number; violated: boolean };

	const arrows = $derived.by((): Arrow[] => {
		return deps.flatMap((dep) => {
			const pred = localTasks.find((t) => t.id === dep.predecessorId);
			const succ = localTasks.find((t) => t.id === dep.successorId);
			if (!pred || !succ) return [];
			const r1 = taskRow.get(pred.id);
			const r2 = taskRow.get(succ.id);
			if (r1 === undefined || r2 === undefined) return [];
			return [
				{
					x1: barRight(pred),
					y1: r1 * ROW_H + ROW_H / 2,
					x2: barLeft(succ),
					y2: r2 * ROW_H + ROW_H / 2,
					violated: succ.startDate < pred.endDate
				}
			];
		});
	});

	// ── Today / target X ─────────────────────────────────────────────────────

	const todayX = $derived(dateX.get(today));
	const targetX = $derived(dateX.get(series.targetDate));

	// ── Drag ─────────────────────────────────────────────────────────────────

	type DragState = {
		taskId: string;
		origStart: string;
		origEnd: string;
		durationDays: number;
		startWdIdx: number;
		offsetX: number;
	};
	let drag: DragState | null = $state(null);
	let outerEl: HTMLElement | undefined = $state();

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
		const cx = clientToCanvasX(e.clientX) - drag.offsetX;
		const snapped = snapX(cx);
		if (!snapped) return;
		const sIdx = workingDays.findIndex((d) => d.date === snapped);
		if (sIdx < 0) return;
		const eIdx = sIdx + drag.durationDays - 1;
		if (eIdx >= workingDays.length) return;
		const newStart = workingDays[sIdx].date;
		const newEnd = workingDays[eIdx].date;
		localTasks = localTasks.map((t) =>
			t.id === drag!.taskId ? { ...t, startDate: newStart, endDate: newEnd } : t
		);
	}

	async function onPointerUp() {
		if (!drag) return;
		const d = drag;
		drag = null; // clear immediately so $effect re-sync doesn't fire mid-save

		// Find the task's current optimistic state
		const moved = localTasks.find((t) => t.id === d.taskId);
		if (!moved || (moved.startDate === d.origStart && moved.endDate === d.origEnd)) return;

		try {
			const res = await fetch(`/api/tasks/${d.taskId}/schedule`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					start: moved.startDate,
					durationDays: moved.durationDays,
					version: moved.version
				})
			});

			if (res.ok) {
				const { changed } = (await res.json()) as { changed: Task[] };
				// Merge server response (includes propagated tasks)
				localTasks = localTasks.map((t) => {
					const sv = changed.find((c: Task) => c.id === t.id);
					return sv ? { ...t, ...sv } : t;
				});
			} else if (res.status === 409) {
				// Version conflict: revert this task
				localTasks = localTasks.map((t) =>
					t.id === d.taskId
						? { ...t, startDate: d.origStart, endDate: d.origEnd, durationDays: d.durationDays }
						: t
				);
			}
		} catch {
			// Network error: revert
			localTasks = localTasks.map((t) =>
				t.id === d.taskId
					? { ...t, startDate: d.origStart, endDate: d.origEnd, durationDays: d.durationDays }
					: t
			);
		}
	}

	// ── Resize ────────────────────────────────────────────────────────────────

	type ResizeState = { taskId: string; edge: 'left' | 'right'; origStart: string; origEnd: string };
	let resizing: ResizeState | null = $state(null);

	// Re-sync local tasks from prop when idle (e.g., on server-side reload)
	$effect(() => {
		if (!drag && !resizing) localTasks = [...tasksProp];
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
		resizing = { taskId: task.id, edge, origStart: task.startDate, origEnd: task.endDate };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onEdgeMove(e: PointerEvent) {
		if (!resizing) return;
		const cx = clientToCanvasX(e.clientX);
		const snapped = snapX(cx);
		if (!snapped) return;
		localTasks = localTasks.map((t) => {
			if (t.id !== resizing!.taskId) return t;
			if (resizing!.edge === 'left') {
				if (snapped >= t.endDate) return t;
				const dur =
					workingDays.findIndex((d) => d.date === t.endDate) -
					workingDays.findIndex((d) => d.date === snapped) +
					1;
				return { ...t, startDate: snapped, durationDays: Math.max(1, dur) };
			} else {
				if (snapped <= t.startDate) return t;
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

		try {
			const res = await fetch(`/api/tasks/${r.taskId}/schedule`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					start: moved.startDate,
					durationDays: moved.durationDays,
					version: moved.version
				})
			});

			if (res.ok) {
				const { changed } = (await res.json()) as { changed: Task[] };
				localTasks = localTasks.map((t) => {
					const sv = changed.find((c: Task) => c.id === t.id);
					return sv ? { ...t, ...sv } : t;
				});
			} else if (res.status === 409) {
				localTasks = localTasks.map((t) =>
					t.id === r.taskId ? { ...t, startDate: r.origStart, endDate: r.origEnd } : t
				);
			}
		} catch {
			localTasks = localTasks.map((t) =>
				t.id === r.taskId ? { ...t, startDate: r.origStart, endDate: r.origEnd } : t
			);
		}
	}

	// ── Helpers ───────────────────────────────────────────────────────────────

	function catCls(cat: string) {
		return `cat-${cat}`;
	}

	function statusCls(s: string) {
		return `st-${s.replace('_', '-')}`;
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

<div class="sl-root">
	<!-- Toolbar -->
	<div class="sl-toolbar">
		<span class="sl-series-name">{series.name}</span>
		<div class="sl-toolbar-actions">
			<div class="btn-seg">
				<button class:on={laneMode === 'book'} onclick={() => (laneMode = 'book')}>By book</button>
				<button class:on={laneMode === 'person'} onclick={() => (laneMode = 'person')}
					>By person</button
				>
			</div>
			<button
				class="btn-toggle"
				class:on={critPath}
				onclick={() => (critPath = !critPath)}
				title="C"
			>
				Critical path
			</button>
			{#if series.strictMode}
				<span class="badge-strict">Strict</span>
			{/if}
		</div>
	</div>

	<!-- Scrollable canvas -->
	<div
		class="sl-outer"
		bind:this={outerEl}
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
			<div class="sl-bg" style="left:{LABEL_W}px;width:{totalW}px;height:{lanes.length * ROW_H}px">
				{#each calDays as day}
					{#if day.isWeekend}
						<div class="sl-wknd" style="left:{dateX.get(day.date) ?? 0}px;width:{WKND_W}px"></div>
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
				style="left:{LABEL_W}px;width:{totalW}px;height:{lanes.length * ROW_H}px"
			>
				<defs>
					<marker id="ah" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
						<path d="M 0 0 L 6 3 L 0 6 Z" fill="var(--muted-foreground)" />
					</marker>
					<marker id="ah-v" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
						<path d="M 0 0 L 6 3 L 0 6 Z" fill="var(--danger)" />
					</marker>
				</defs>
				{#each arrows as a}
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
				<div class="sl-lane" style="height:{ROW_H}px">
					<!-- Sticky label -->
					<div class="sl-label">
						<span class="sl-label-code">{lane.label}</span>
						{#if lane.sublabel && laneMode === 'book'}
							<span class="sl-label-name">{lane.sublabel}</span>
						{/if}
					</div>
					<!-- Task bars -->
					<div class="sl-canvas" style="width:{totalW}px">
						{#each lane.tasks as task}
							{@const stage = stageMap.get(task.stageId)}
							{@const bx = barLeft(task)}
							{@const bw = barWidth(task)}
							{@const isGate = stage?.category === 'gate'}
							{@const isDone = task.status === 'done'}
							{@const isCpFaded = critPath && !isDone}

							{#if isGate}
								<!-- Diamond marker -->
								<div
									class="sl-gate"
									style="left:{bx + DAY_W / 2 - 9}px;top:{ROW_H / 2 - 9}px"
									title={stage?.name ?? ''}
									class:cp-dim={isCpFaded}
								></div>
							{:else}
								<div
									class="sl-bar {catCls(stage?.category ?? 'creation')} {statusCls(task.status)}"
									class:cp-dim={isCpFaded}
									style="left:{bx}px;width:{bw}px;top:4px;height:{ROW_H - 8}px"
									onpointerdown={(e) => onBarDown(e, task)}
									role="button"
									tabindex="0"
									title="{stage?.name ?? ''} · {bookMap.get(task.bookId)?.code ?? ''}"
								>
									<!-- Resize handles -->
									<span
										class="sl-edge sl-edge--l"
										onpointerdown={(e) => onEdgeDown(e, task, 'left')}
										role="presentation"
									></span>
									<span class="sl-bar-lbl">
										{stage?.name ?? ''}
										{#if task.iteration > 1}<em>×{task.iteration}</em>{/if}
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
		opacity: 0.25;
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
