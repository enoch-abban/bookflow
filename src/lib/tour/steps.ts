// The guided tour: one walk through the app, shaped by the person's role. Each step points at
// an element marked data-tour="<target>" on a page; the tour opens that page first if needed.
// Steps whose element is missing (a series with no books, say) are skipped as it runs.

export type Role = 'admin' | 'coordinator' | 'contributor' | 'viewer';
export type TourContext = { seriesId: string | null; role: Role; seriesCount: number };

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
};

const s = (c: TourContext, rest = '') => (c.seriesId ? `/s/${c.seriesId}${rest}` : null);
const MANAGE: Role[] = ['admin', 'coordinator'];

export const STEPS: Step[] = [
	{
		id: 'welcome', path: () => null, target: null,
		title: 'Welcome to bookflow',
		body: 'This short tour shows where things are. Use the arrow keys or the buttons to move, and Esc to stop. You can replay it any time from Tour in the top bar.',
	},
	{
		id: 'series', path: () => null, target: 'series-switch',
		title: 'Series',
		body: 'Each production run is a series with its own pipeline, team and dates. Switch between them here; you stay on the same kind of page.',
	},
	{
		id: 'matrix', path: (c) => s(c), target: 'matrix', needsSeries: true,
		title: 'Status matrix',
		body: 'Every book against every stage. Each cell shows the task’s status and dates; late and at-risk work stands out. Click a book code to open its page.',
	},
	{
		id: 'strip', path: (c) => s(c), target: 'series-strip', needsSeries: true,
		title: 'Projected finish',
		body: 'The series’ projected finish (the latest binding) against its target date and hard limit, with counts of late and at-risk tasks.',
	},
	{
		id: 'swimlane', path: (c) => s(c, '/swimlane'), target: 'swimlane-canvas', needsSeries: true,
		title: 'Swimlane',
		body: 'The plan on a timeline. Coordinators drag a bar to move a task or pull its edge to resize it; the tasks after it move along, and window rules are checked as you go.',
	},
	{
		id: 'undo', path: (c) => s(c, '/swimlane'), target: 'undo-redo', needsSeries: true, roles: MANAGE,
		title: 'Undo and redo',
		body: 'Step back through your last 50 changes on this series, and forward again. Ctrl+Z undoes, Ctrl+Shift+Z redoes. Undo is refused, naming the tasks, if someone has changed them since.',
	},
	{
		id: 'critical', path: (c) => s(c, '/swimlane'), target: 'critical-path', needsSeries: true,
		title: 'Critical path',
		body: 'Outlines the tasks that cannot slip without delaying the finish and fades the rest. Press C to toggle it.',
	},
	{
		id: 'workload', path: (c) => s(c, '/workload'), target: 'workload-grid', needsSeries: true,
		title: 'Workload',
		body: 'Task days per person per working day, against each person’s capacity. Red cells are over capacity; click any cell to see the tasks behind it.',
	},
	{
		id: 'me', path: () => '/me', target: 'my-tasks',
		title: 'My tasks',
		body: 'Your open work across every series, most urgent first. Start, finish or submit a task for review here, and approve or return work waiting for your review.',
		roles: ['admin', 'coordinator', 'contributor'],
	},
	{
		id: 'baselines', path: (c) => s(c, '/baselines'), target: 'baseline-save', needsSeries: true, roles: MANAGE,
		title: 'Baselines',
		body: 'Freeze the current plan’s dates as a baseline (Rev 5, Rev 6…) and see how far each task and book has slipped against it.',
	},
	{
		id: 'activity', path: (c) => s(c, '/activity'), target: 'activity-list', needsSeries: true, roles: MANAGE,
		title: 'Activity',
		body: 'Every change on the series, newest first, with who made it. Undo your own recent changes from here, or redo what you undid.',
	},
	{
		id: 'settings', path: (c) => s(c, '/settings'), target: 'settings-pipeline', needsSeries: true, roles: MANAGE,
		title: 'Series settings',
		body: 'Dates, print defaults, windows, the pipeline (tracks, stages and books) and the team. Changes that move tasks show their impact before anything is saved.',
	},
	{
		id: 'templates', path: () => '/templates', target: 'templates', roles: ['admin'],
		title: 'Templates',
		body: 'Saved pipelines. Start a new series from one to copy its tracks, stages, dependency pattern, team labels and settings.',
	},
	{
		id: 'admin', path: () => null, target: 'admin-links', roles: ['admin'],
		title: 'People and calendar',
		body: 'Invite people and manage accounts under People. Holidays under Calendar apply to every series: tasks skip them like weekends.',
	},
	{
		id: 'done', path: () => null, target: 'tour-button',
		title: 'That’s the tour',
		body: 'Replay it any time from here.',
	},
];

/** The steps this person sees, in order. */
export function stepsFor(c: TourContext): Step[] {
	return STEPS.filter((st) => (!st.roles || st.roles.includes(c.role)) && (!st.needsSeries || c.seriesId) && (st.id !== 'series' || c.seriesCount > 1 || c.role === 'admin'));
}
