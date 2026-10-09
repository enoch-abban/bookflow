// The guided tour: one walk through the app, shaped by the person's role. Each step points at
// an element marked data-tour="<target>" on a page; the tour opens that page first if needed.
// Steps whose element is missing (a series with no books, say) are skipped as it runs.
//
// Each step records the tour version it arrived in. People who finished an older version get
// a short "What's new" run of just the newer steps; the Tour button always replays them all.

export const TOUR_VERSION = 2;

export type Role = 'admin' | 'manager' | 'coordinator' | 'contributor' | 'viewer';
export type TourContext = { seriesId: string | null; role: Role; seriesCount: number };

/** What the page should look like for a step; the tour sets it up and puts it back after. */
export type StepState = {
	/** Open the task drawer on the first task in the matrix. */
	drawer?: boolean;
	/** Show the swimlane by person. */
	lanes?: 'person';
};

export type Step = {
	id: string;
	/** Page to open first; null keeps the current page (the nav is on every page). */
	path: (c: TourContext) => string | null;
	/** data-tour value of the element to highlight; null centres the card with nothing highlighted. */
	target: string | null;
	title: string;
	body: string;
	/** Who sees it; everyone when omitted. */
	roles?: Role[];
	/** Needs a series to be open. */
	needsSeries?: boolean;
	/** The tour version this step arrived in. */
	since: number;
	state?: StepState;
};

const s = (c: TourContext, rest = '') => (c.seriesId ? `/s/${c.seriesId}${rest}` : null);
const MANAGE: Role[] = ['admin', 'manager', 'coordinator'];

export const STEPS: Step[] = [
	{
		id: 'welcome', path: () => null, target: null, since: 1,
		title: 'Welcome to bookflow',
		body: 'This short tour shows where things are. Use the arrow keys or the buttons to move, and Esc to stop. You can replay it any time from Tour in the top bar.',
	},
	{
		id: 'series', path: () => null, target: 'series-switch', since: 1,
		title: 'Series',
		body: 'Each production run is a series with its own pipeline, team and dates. Switch between them here; you stay on the same kind of page.',
	},
	{
		id: 'matrix', path: (c) => s(c), target: 'matrix', needsSeries: true, since: 1,
		title: 'Status matrix',
		body: 'Every book against every stage. Each cell shows the task’s status, lead and dates; late and at-risk work stands out. Click a book code to open its page.',
	},
	{
		id: 'filters', path: (c) => s(c), target: 'matrix-filters', needsSeries: true, since: 2,
		title: 'Filters',
		body: 'Narrow the matrix by group, batch, person or status. Choose Unassigned under Person to find work nobody has yet; the header counts unassigned tasks starting in the next five working days.',
	},
	{
		id: 'drawer', path: (c) => s(c), target: 'task-drawer', needsSeries: true, since: 2, state: { drawer: true },
		title: 'Task drawer',
		body: 'Click any cell, swimlane bar, My tasks row or task on a book page to open it here: status, dates, notes, what it comes after and before, comments and its history.',
	},
	{
		id: 'drawer-assignees', path: (c) => s(c), target: 'drawer-assignees', needsSeries: true, since: 2, roles: MANAGE, state: { drawer: true },
		title: 'Assigning people',
		body: 'Edit lists the series’ members by team with their workload over the task’s dates. The first person you add leads; the star moves the lead. Assigned work appears in their My tasks.',
	},
	{
		id: 'strip', path: (c) => s(c), target: 'series-strip', needsSeries: true, since: 1,
		title: 'Projected finish',
		body: 'The series’ projected finish (the latest binding) against its target date and hard limit, with counts of late and at-risk tasks.',
	},
	{
		id: 'swimlane', path: (c) => s(c, '/swimlane'), target: 'swimlane-canvas', needsSeries: true, since: 1,
		title: 'Swimlane',
		body: 'The plan on a timeline. Coordinators drag a bar to move a task or pull its edge to resize it; the tasks after it move along, and window rules are checked as you go.',
	},
	{
		id: 'reassign', path: (c) => s(c, '/swimlane'), target: 'unassigned-lane', needsSeries: true, since: 2, roles: MANAGE, state: { lanes: 'person' },
		title: 'Reassign by dragging',
		body: 'By person, unassigned work waits in the lane at the top. Drag a bar into someone’s lane to give it to them, between lanes to swap people, or back here to unassign it.',
	},
	{
		id: 'undo', path: (c) => s(c, '/swimlane'), target: 'undo-redo', needsSeries: true, roles: MANAGE, since: 1,
		title: 'Undo and redo',
		body: 'Step back through your last 50 changes on this series, reassignments included, and forward again. Ctrl+Z undoes, Ctrl+Shift+Z redoes. Undo is refused, naming the tasks, if someone has changed them since.',
	},
	{
		id: 'critical', path: (c) => s(c, '/swimlane'), target: 'critical-path', needsSeries: true, since: 1,
		title: 'Critical path',
		body: 'Outlines the tasks that cannot slip without delaying the finish and fades the rest. Press C to toggle it.',
	},
	{
		id: 'workload', path: (c) => s(c, '/workload'), target: 'workload-grid', needsSeries: true, since: 1,
		title: 'Workload',
		body: 'Task days per person per working day, against each person’s capacity. Red cells are over capacity; click any cell to see the tasks behind it.',
	},
	{
		id: 'me', path: () => '/me', target: 'my-tasks', since: 1,
		title: 'My tasks',
		body: 'Your open work across every series, most urgent first. Start, finish or submit a task for review here, and approve or return work waiting for your review.',
		roles: ['admin', 'manager', 'coordinator', 'contributor'],
	},
	{
		id: 'baselines', path: (c) => s(c, '/baselines'), target: 'baseline-save', needsSeries: true, roles: MANAGE, since: 1,
		title: 'Baselines',
		body: 'Freeze the current plan’s dates as a baseline (Rev 5, Rev 6…) and see how far each task and book has slipped against it.',
	},
	{
		id: 'activity', path: (c) => s(c, '/activity'), target: 'activity-list', needsSeries: true, roles: MANAGE, since: 1,
		title: 'Activity',
		body: 'Every change on the series, newest first, with who made it. Undo your own recent changes from here, or redo what you undid.',
	},
	{
		id: 'settings', path: (c) => s(c, '/settings'), target: 'settings-pipeline', needsSeries: true, roles: MANAGE, since: 1,
		title: 'Series settings',
		body: 'Dates, print defaults, windows, the pipeline (tracks, stages and books) and the team. Changes that move tasks show their impact before anything is saved.',
	},
	{
		id: 'templates', path: () => '/templates', target: 'templates', roles: ['admin', 'manager'], since: 1,
		title: 'Templates',
		body: 'Saved pipelines. Start a new series from one to copy its tracks, stages, dependency pattern, team labels and settings.',
	},
	{
		id: 'roles', path: () => '/settings/people', target: 'people-roles', roles: ['admin'], since: 2,
		title: 'App roles',
		body: 'Make someone an Admin or a Manager here. Managers can do what admins can, acting as coordinator on every series, except change roles, holidays, or other admins’ and managers’ accounts. The app always keeps one active admin.',
	},
	{
		id: 'transfer', path: () => '/settings/people', target: 'admin-transfer', roles: ['admin'], since: 2,
		title: 'Handing over the admin role',
		body: 'Moving on? Transfer your admin role to someone who has signed up. You confirm with your password and an emailed code; nothing changes until they accept from their email.',
	},
	{
		id: 'admin', path: () => null, target: 'admin-links', roles: ['admin'], since: 1,
		title: 'People and calendar',
		body: 'Invite people and manage accounts under People. Holidays under Calendar apply to every series: tasks skip them like weekends.',
	},
	{
		id: 'people', path: () => null, target: 'admin-links', roles: ['manager'], since: 2,
		title: 'You are a manager',
		body: 'You can do what admins do and act as coordinator on every series. Under People you look after members’ accounts; admins look after roles and holidays.',
	},
	{
		id: 'account', path: () => null, target: 'account-menu', since: 2,
		title: 'Your name',
		body: 'Click your name to change how it appears on tasks, comments and the activity log.',
	},
	{
		id: 'done', path: () => null, target: 'tour-button', since: 1,
		title: 'That’s the tour',
		body: 'Replay it any time from here.',
	},
];

const WHATS_NEW: Step = {
	id: 'whats-new', path: () => null, target: null, since: TOUR_VERSION,
	title: 'What’s new in bookflow',
	body: 'A few things have changed since your last tour. This short walk shows only those; the Tour button in the top bar replays everything.',
};

/** The full tour for this person, in order. */
export function stepsFor(c: TourContext): Step[] {
	return STEPS.filter((st) => (!st.roles || st.roles.includes(c.role)) && (!st.needsSeries || c.seriesId) && (st.id !== 'series' || c.seriesCount > 1 || c.role === 'admin' || c.role === 'manager'));
}

/**
 * What starts by itself: the full tour for someone who has never seen it, only the newer
 * steps (with an intro and the closing step) for someone who saw an older version, else nothing.
 */
export function autoTour(c: TourContext, seen: number): Step[] {
	if (seen >= TOUR_VERSION) return [];
	const all = stepsFor(c);
	if (seen <= 0) return all;
	const fresh = all.filter((st) => st.since > seen && st.id !== 'done');
	return fresh.length ? [WHATS_NEW, ...fresh, ...all.filter((st) => st.id === 'done')] : [];
}
