// What notification emails say, and which tasks they are about (spec: Phase 2, notifications
// on handoff, return and lateness). Pure functions: the server loads rows and sends.

export type Kind = 'handoff' | 'review_request' | 'returned' | 'late';
export type Message = { subject: string; body: string };

/** A task as the messages name it: "InDesign · G9". */
export type TaskRef = { stage: string; book: string; series: string; link: string };

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Fri 9 Oct" for "2026-10-09". */
export function shortDate(iso: string): string {
	const d = new Date(`${iso}T12:00:00Z`);
	return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

const name = (t: TaskRef) => `${t.stage} · ${t.book}`;
const list = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);
const FOOTER = '\n\nYou get these emails for tasks you work on. Turn them off from your name in the bookflow top bar.';

/** A task's predecessors are all finished, so its people can start. */
export function handoffMessage(task: TaskRef & { start: string }, finished: string[]): Message {
	return {
		subject: `${name(task)} can start`,
		body:
			`${list(finished)} ${finished.length === 1 ? 'is' : 'are'} done, so ${name(task)} in ${task.series} can start. ` +
			`It is planned to start ${shortDate(task.start)}.\n\n${task.link}${FOOTER}`
	};
}

/** Work was submitted, and these people review it. */
export function reviewRequestMessage(task: TaskRef & { round: number }, submittedBy: string): Message {
	return {
		subject: `Review ${name(task)}`,
		body:
			`${submittedBy} submitted ${name(task)} in ${task.series} for review` +
			`${task.round > 1 ? ` (round ${task.round})` : ''}. Approve it, or return it with a short summary of what needs changing.\n\n` +
			`${task.link}${FOOTER}`
	};
}

/** A reviewer sent the work back. */
export function returnedMessage(task: TaskRef, reviewer: string, summary: string): Message {
	return {
		subject: `${name(task)} was returned`,
		body:
			`${reviewer} returned ${name(task)} in ${task.series} with changes:\n\n  ${summary.replace(/\n/g, '\n  ')}\n\n` +
			`The detail is in the feedback file. Set the task back to In progress when you start the corrections.\n\n${task.link}${FOOTER}`
	};
}

/** One line in a late email, stored per task so it can be listed in the app later. */
export function lateMessage(task: TaskRef & { end: string; people: string[] }): Message {
	const who = task.people.length ? ` (${list(task.people)})` : ' (nobody assigned)';
	return {
		subject: `${name(task)} is late`,
		body: `${name(task)} in ${task.series}${who} was due ${shortDate(task.end)}.\n${task.link}`
	};
}

/** Several late tasks for one person, in one email. */
export function lateDigest(items: Message[]): Message {
	if (items.length === 1) return { subject: items[0].subject, body: `This task is now late:\n\n${items[0].body}${FOOTER}` };
	return {
		subject: `${items.length} tasks are now late`,
		body: `These tasks are now late:\n\n${items.map((i) => i.body).join('\n\n')}${FOOTER}`
	};
}

type Dep = { predecessorId: string; successorId: string };
type St = { id: string; status: string };

/**
 * Tasks that `doneId` finishing lets start: its successors that have not started and whose
 * predecessors are now all Done. A successor still waiting on another task is left out;
 * it is announced when that one finishes.
 */
export function readySuccessors<T extends St>(doneId: string, deps: Dep[], byId: Map<string, T>): T[] {
	return deps
		.filter((d) => d.predecessorId === doneId)
		.map((d) => byId.get(d.successorId))
		.filter((s): s is T => !!s && s.status === 'not_started')
		.filter((s) => deps.filter((d) => d.successorId === s.id).every((d) => byId.get(d.predecessorId)?.status === 'done'));
}

/** Late as the matrix counts it: scheduled, not Done, and its end date has passed. */
export function isLate(t: { status: string; endDate: string; scheduleState: string }, today: string): boolean {
	return t.scheduleState === 'scheduled' && t.status !== 'done' && t.endDate < today;
}

/** One "turned late" notice per task and end date: if it is moved and slips again, it is new news. */
export const lateKey = (t: { id: string; endDate: string }) => `late:${t.id}:${t.endDate}`;
