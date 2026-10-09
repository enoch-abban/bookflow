// Plain-language lines for activity log entries (spec: Activity log). Pure, so the page,
// the undo endpoint and tests share one wording.

import { statusLabel } from '../status.ts';

export type LogEntry = {
	id: string; entity: string; entityId: string; action: string;
	before: Record<string, unknown> | null; after: Record<string, unknown> | null;
};

/** Names for ids that appear in entries; anything missing falls back to a generic word. */
export type Names = {
	task: (id: string) => string | undefined;
	book: (id: string) => string | undefined;
	stage: (id: string) => string | undefined;
	track: (id: string) => string | undefined;
	window: (id: string) => string | undefined;
	person: (id: string) => string | undefined;
};

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDate = (d: unknown) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${MONTHS[+d.slice(5, 7)]} ${+d.slice(8, 10)}` : String(d));
const span = (o: Record<string, unknown>) => (o.startDate === o.endDate ? fmtDate(o.startDate) : `${fmtDate(o.startDate)} – ${fmtDate(o.endDate)}`);

// Settings fields in words, for series, stage, book and track updates.
const FIELD: Record<string, string> = {
	name: 'name', targetDate: 'target date', hardLimitDate: 'hard limit', status: 'status', bookGroupLabel: 'group label',
	enforceWindows: 'window enforcement', strictMode: 'strict mode', defaultCopies: 'default copies',
	legalDepositCopies: 'deposit copies', printBufferDays: 'print buffer', windowOverflowDays: 'window overflow',
	defaultDays: 'default days', isReview: 'review stage', isExternal: 'external', ignoresWindows: 'ignores windows',
	deadlineRule: 'deadline rule', archivedAt: 'archived', code: 'code', groupLabel: 'group', isbn: 'ISBN', edition: 'edition',
	batch: 'batch', trackId: 'track', category: 'category',
};
function value(k: string, v: unknown): string {
	if (v === null || v === undefined || v === '') return 'none';
	if (typeof v === 'number' && ['enforceWindows', 'strictMode', 'isReview', 'isExternal', 'ignoresWindows'].includes(k)) return v ? 'on' : 'off';
	if (typeof v === 'boolean') return v ? 'on' : 'off';
	if (k === 'archivedAt') return 'yes';
	return fmtDate(v);
}
function fieldChanges(before: Record<string, unknown> | null, after: Record<string, unknown> | null): string {
	const keys = Object.keys(after ?? {}).filter((k) => !['version', 'updatedAt', 'id', 'seriesId', 'sortOrder'].includes(k) && before?.[k] !== after?.[k]);
	if (!keys.length) return 'settings';
	return keys.slice(0, 3).map((k) => `${FIELD[k] ?? k} ${before && k in before ? `${value(k, before[k])} → ` : ''}${value(k, after![k])}`).join(', ') + (keys.length > 3 ? ` and ${keys.length - 3} more` : '');
}

/** Name of the row an entry is about, from the names lookup or the snapshot it carries. */
function label(e: LogEntry, n: Names): string {
	const snap = (e.after ?? e.before ?? {}) as Record<string, unknown>;
	const inner = (snap[e.entity] ?? snap) as Record<string, unknown>;
	switch (e.entity) {
		case 'task': return n.task(e.entityId) ?? (inner.title as string) ?? 'a task';
		case 'book': return n.book(e.entityId) ?? (inner.code as string) ?? 'a book';
		case 'stage': return n.stage(e.entityId) ?? (inner.name as string) ?? 'a stage';
		case 'track': return n.track(e.entityId) ?? (inner.name as string) ?? 'a track';
		case 'window': return n.window(e.entityId) ?? (inner.label as string) ?? 'a window';
		default: return '';
	}
}

export function describe(e: LogEntry, n: Names): string {
	const b = e.before ?? {};
	const a = e.after ?? {};
	const name = label(e, n);
	const undo = e.action === 'undo' || e.action === 'redo';
	// Undo and redo entries are described by their effect: created, removed or restored.
	const verb = undo ? (e.before && !e.after ? 'removed' : !e.before && e.after ? 'brought back' : 'restored') : '';

	switch (e.entity) {
		case 'task':
			if (e.action === 'status') return `${name}: ${statusLabel(String(b.status))} → ${statusLabel(String(a.status))}`;
			if (e.action === 'deadline') return `${name}: due date ${a.dueDate ? fmtDate(a.dueDate) : 'cleared'}`;
			// An assignment, or an undo or redo of one.
			if (e.action === 'reassign' || Array.isArray(a.personIds)) {
				const ids = Array.isArray(a.personIds) ? (a.personIds as string[]) : [];
				if (!ids.length) return `${name} unassigned`;
				const lead = typeof a.leadId === 'string' ? a.leadId : ids[0];
				const who = [lead, ...ids.filter((id) => id !== lead)].map((id) => n.person(id) ?? 'someone');
				return `${name} assigned to ${who.join(', ')}${ids.length > 1 ? ` (${who[0]} leads)` : ''}`;
			}
			if (e.action === 'create') return `Added task ${name}`;
			if (e.action === 'delete') return `Removed task ${name}`;
			if (undo && verb !== 'restored') return `${name} ${verb}`;
			if (a.scheduleState === 'unscheduled' && b.scheduleState !== 'unscheduled') return `${name} unscheduled`;
			if ('startDate' in a && 'startDate' in b) {
				const what = e.action === 'resize' ? 'resized' : undo ? 'restored' : 'moved';
				return `${name} ${what}: ${span(b)} → ${span(a)}`;
			}
			if ('overflowAllowed' in a) return `${name}: overflow ${a.overflowAllowed ? 'allowed' : 'not allowed'}`;
			return `${name} ${undo ? 'restored' : 'updated'}`;
		case 'series':
			if (e.action === 'created') return 'Created the series';
			return `Series ${fieldChanges(b, a)}`;
		case 'stage': case 'book': case 'track':
			if (e.action === 'create') return `Added ${e.entity} ${name}`;
			if (e.action === 'delete') return `Removed ${e.entity} ${name}`;
			if (e.action === 'reorder') return `Reordered ${e.entity}s`;
			if (undo && verb !== 'restored') return `${e.entity[0].toUpperCase()}${e.entity.slice(1)} ${name} ${verb}`;
			return `${e.entity[0].toUpperCase()}${e.entity.slice(1)} ${name}: ${fieldChanges(b, a)}`;
		case 'window': {
			const w = (e.after ?? e.before ?? {}) as Record<string, unknown>;
			if (!e.before) return `${undo ? 'Brought back' : 'Added'} window ${w.label} (${span(w)})`;
			if (!e.after) return `${undo ? 'Removed' : 'Deleted'} window ${b.label}`;
			return `Window ${a.label}: ${span(b)} → ${span(a)}`;
		}
		case 'dependency': {
			const d = (e.after ?? e.before ?? {}) as Record<string, unknown>;
			const link = `${n.task(d.predecessorId as string) ?? 'a task'} → ${n.task(d.successorId as string) ?? 'a task'}`;
			return e.after ? `Linked ${link}` : `Unlinked ${link}`;
		}
		case 'stage_link': {
			const l = (e.after ?? e.before ?? {}) as Record<string, unknown>;
			const link = `${n.stage(l.fromStageId as string) ?? 'a stage'} → ${n.stage(l.toStageId as string) ?? 'a stage'}`;
			return e.after ? `Pattern: linked ${link}` : `Pattern: unlinked ${link}`;
		}
		case 'skip': {
			const s = (e.after ?? e.before ?? {}) as Record<string, unknown>;
			const what = `${n.stage(s.stageId as string) ?? 'a stage'} for ${n.book(s.bookId as string) ?? 'a book'}`;
			return e.after ? `Skipped ${what}` : `Stopped skipping ${what}`;
		}
		case 'holiday':
			return e.after ? `Added holiday ${fmtDate(e.entityId)}${a.name ? ` (${a.name})` : ''}` : `Removed holiday ${fmtDate(e.entityId)}`;
		case 'print_record':
			if (e.action === 'apply_defaults') return `Print defaults applied to ${n.book(e.entityId) ?? 'a book'}`;
			return `Print record for ${n.book(e.entityId) ?? 'a book'}: ${fieldChanges(b, a)}`;
		case 'approval':
			return `Approved ${n.book(e.entityId) ?? (a.bookId ? n.book(a.bookId as string) : undefined) ?? 'a book'} for print`;
		case 'review':
			return e.action === 'approved'
				? `Approved ${n.task(e.entityId) ?? 'a review'}`
				: `Returned ${n.task(e.entityId) ?? 'a task'} with changes${a.summary ? `: “${String(a.summary).slice(0, 80)}”` : ''}`;
		case 'comment':
			return `Commented on ${n.task((a.taskId as string) ?? e.entityId) ?? 'a task'}${a.body ? `: “${String(a.body).slice(0, 80)}”` : ''}`;
		case 'baseline':
			return `Saved baseline ${a.name ?? ''}`.trim();
		case 'member':
			return e.action === 'update'
				? `${n.person((a.personId as string) ?? e.entityId) ?? 'Someone'}'s membership: ${fieldChanges(b, a)}`
				: `Added ${n.person((a.personId as string) ?? e.entityId) ?? 'someone'} to the series`;
		case 'person':
			if (e.action === 'password_reset') return `Sent a password reset to ${n.person(e.entityId) ?? 'someone'}`;
			if (e.action === 'role') {
				const role = String(a.systemRole ?? '');
				return `${n.person(e.entityId) ?? (a.displayName as string) ?? 'Someone'} is now ${role === 'admin' ? 'an Admin' : role === 'manager' ? 'a Manager' : 'a Member'}${a.via === 'admin_transfer' ? ' (admin transfer)' : ''}`;
			}
			if (e.action === 'update') return `${n.person(e.entityId) ?? 'Someone'}: ${fieldChanges(b, a)}`;
			return `Added person ${(a.displayName as string) ?? n.person(e.entityId) ?? ''}`.trim();
		case 'admin_transfer':
			if (e.action === 'create') return `Offered the admin role to ${(a.toName as string) ?? n.person(a.to as string) ?? 'someone'}`;
			if (e.action === 'accept') return `${n.person(a.to as string) ?? 'The recipient'} accepted the admin role`;
			if (e.action === 'decline') return 'Declined an admin role transfer';
			if (e.action === 'cancel') return 'Cancelled an admin role transfer';
			if (e.action === 'void') return `An admin role transfer lapsed (${a.reason ?? 'voided'})`;
			return 'Admin role transfer';
		case 'invite':
			if (e.action === 'accept') return `${(a.displayName as string) ?? n.person(a.personId as string) ?? 'Someone'} accepted their invite`;
			if (e.action === 'revoke') return `Revoked an invite for ${n.person(a.personId as string) ?? 'someone'}`;
			return `Invited ${n.person(a.personId as string) ?? (a.email as string) ?? 'someone'}`;
	}
	return `${e.action} ${e.entity}`;
}

export type BatchKind = 'change' | 'undo' | 'redo';
export function batchKind(entries: LogEntry[]): BatchKind {
	if (entries.length && entries.every((e) => e.action === 'undo')) return 'undo';
	if (entries.length && entries.every((e) => e.action === 'redo')) return 'redo';
	return 'change';
}

// Task moves pushed along by a change; the headline names the change, then counts these.
const FOLLOW_ON = new Set(['move', 'place', 'unschedule', 'rewindow']);

/** One line for a whole batch: its main change, then how many other changes came with it. */
export function headline(entries: LogEntry[], n: Names): string {
	if (!entries.length) return '';
	const kind = batchKind(entries);
	if (kind !== 'change') {
		const tasks = entries.filter((e) => e.entity === 'task').length;
		const other = entries.length - tasks;
		const parts = [tasks && `${tasks} ${tasks === 1 ? 'task' : 'tasks'}`, other && `${other} other ${other === 1 ? 'change' : 'changes'}`].filter(Boolean);
		return `${kind === 'undo' ? 'Undid' : 'Redid'} a change: ${parts.join(' and ')}`;
	}
	const main = entries.find((e) => !(e.entity === 'task' && FOLLOW_ON.has(e.action))) ?? entries[0];
	const rest = entries.filter((e) => e !== main);
	const moved = rest.filter((e) => e.entity === 'task').length;
	const others = rest.length - moved;
	const tail = [moved && `${moved} ${moved === 1 ? 'task' : 'tasks'} moved`, others && `${others} more ${others === 1 ? 'change' : 'changes'}`].filter(Boolean).join(', ');
	return describe(main, n) + (tail ? `; ${tail}` : '');
}
