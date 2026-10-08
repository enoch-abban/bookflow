import { sqliteTable, text, integer, real, index, primaryKey } from 'drizzle-orm/sqlite-core';
import { ulid } from 'ulid';

export * from './auth.schema';

const newId = () => ulid();

// ── Series, templates, pipeline ────────────────────────────────────────────

export const templates = sqliteTable('templates', {
	id: text('id').primaryKey().$defaultFn(newId),
	name: text('name').notNull(),
	description: text('description'),
	definitionJson: text('definition_json').notNull(),
	createdBy: text('created_by'),
	createdAt: text('created_at').notNull()
});

export const series = sqliteTable('series', {
	id: text('id').primaryKey().$defaultFn(newId),
	name: text('name').notNull(),
	templateId: text('template_id'),
	status: text('status', { enum: ['planning', 'active', 'closed'] }).notNull().default('active'),
	startDate: text('start_date').notNull(),
	targetDate: text('target_date').notNull(),
	hardLimitDate: text('hard_limit_date'),
	bookGroupLabel: text('book_group_label').notNull().default('Group'),
	enforceWindows: integer('enforce_windows').notNull().default(0),
	strictMode: integer('strict_mode').notNull().default(0),
	defaultCopies: integer('default_copies').notNull().default(20),
	legalDepositCopies: integer('legal_deposit_copies').notNull().default(0),
	printBufferDays: integer('print_buffer_days').notNull().default(1),
	windowOverflowDays: integer('window_overflow_days').notNull().default(0)
});

export const tracks = sqliteTable(
	'tracks',
	{
		id: text('id').primaryKey().$defaultFn(newId),
		seriesId: text('series_id')
			.notNull()
			.references(() => series.id, { onDelete: 'cascade' }),
		key: text('key').notNull(),
		name: text('name').notNull(),
		sortOrder: integer('sort_order').notNull()
	},
	(t) => [index('idx_tracks_series').on(t.seriesId)]
);

export const stages = sqliteTable(
	'stages',
	{
		id: text('id').primaryKey().$defaultFn(newId),
		seriesId: text('series_id')
			.notNull()
			.references(() => series.id, { onDelete: 'cascade' }),
		key: text('key').notNull(),
		name: text('name').notNull(),
		category: text('category', {
			enum: ['creation', 'review', 'layout', 'publish', 'gate', 'production']
		}).notNull(),
		sortOrder: integer('sort_order').notNull(),
		defaultDays: integer('default_days').notNull().default(1),
		isReview: integer('is_review').notNull().default(0),
		isExternal: integer('is_external').notNull().default(0),
		ignoresWindows: integer('ignores_windows').notNull().default(0),
		deadlineRule: text('deadline_rule'), // JSON e.g. {"after":"isbn_issued","months":2}
		archivedAt: text('archived_at') // set on removal when Done tasks keep history
	},
	(t) => [index('idx_stages_series').on(t.seriesId)]
);

export const stageTracks = sqliteTable(
	'stage_tracks',
	{
		stageId: text('stage_id')
			.notNull()
			.references(() => stages.id, { onDelete: 'cascade' }),
		trackId: text('track_id')
			.notNull()
			.references(() => tracks.id, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ columns: [t.stageId, t.trackId] })]
);

export const books = sqliteTable(
	'books',
	{
		id: text('id').primaryKey().$defaultFn(newId),
		seriesId: text('series_id')
			.notNull()
			.references(() => series.id, { onDelete: 'cascade' }),
		trackId: text('track_id').notNull(),
		code: text('code').notNull(),
		name: text('name').notNull(),
		groupLabel: text('group_label'),
		isbn: text('isbn').unique(),
		edition: text('edition'),
		batch: integer('batch'),
		sortOrder: integer('sort_order').notNull(),
		version: integer('version').notNull().default(1),
		archivedAt: text('archived_at') // set instead of deleting once work has started
	},
	(t) => [index('idx_books_series').on(t.seriesId)]
);

// The series' default dependency pattern, applied when tasks are created.
export const stageLinks = sqliteTable(
	'stage_links',
	{
		fromStageId: text('from_stage_id')
			.notNull()
			.references(() => stages.id, { onDelete: 'cascade' }),
		toStageId: text('to_stage_id')
			.notNull()
			.references(() => stages.id, { onDelete: 'cascade' }),
		lagDays: integer('lag_days').notNull().default(0)
	},
	(t) => [primaryKey({ columns: [t.fromStageId, t.toStageId] })]
);

// Stages a book deliberately does not have.
export const bookStageSkips = sqliteTable(
	'book_stage_skips',
	{
		bookId: text('book_id')
			.notNull()
			.references(() => books.id, { onDelete: 'cascade' }),
		stageId: text('stage_id')
			.notNull()
			.references(() => stages.id, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ columns: [t.bookId, t.stageId] })]
);

// ── People, membership, invites ─────────────────────────────────────────────

export const people = sqliteTable('people', {
	id: text('id').primaryKey().$defaultFn(newId),
	userId: text('user_id').unique(), // null until invite accepted
	displayName: text('display_name').notNull(),
	email: text('email').unique(),
	isAdmin: integer('is_admin').notNull().default(0),
	active: integer('active').notNull().default(1)
});

export const seriesMembers = sqliteTable(
	'series_members',
	{
		seriesId: text('series_id')
			.notNull()
			.references(() => series.id, { onDelete: 'cascade' }),
		personId: text('person_id')
			.notNull()
			.references(() => people.id),
		role: text('role', { enum: ['coordinator', 'contributor', 'viewer'] }).notNull(),
		teamLabel: text('team_label'),
		capacity: real('capacity').notNull().default(1)
	},
	(t) => [primaryKey({ columns: [t.seriesId, t.personId] })]
);

export const invites = sqliteTable(
	'invites',
	{
		id: text('id').primaryKey().$defaultFn(newId),
		personId: text('person_id')
			.notNull()
			.references(() => people.id),
		email: text('email').notNull(),
		tokenHash: text('token_hash').notNull().unique(),
		invitedBy: text('invited_by')
			.notNull()
			.references(() => people.id),
		createdAt: text('created_at').notNull(),
		expiresAt: text('expires_at').notNull(),
		acceptedAt: text('accepted_at'),
		revokedAt: text('revoked_at')
	},
	(t) => [index('idx_invites_person').on(t.personId)]
);

// ── Calendar ─────────────────────────────────────────────────────────────────

export const windows = sqliteTable('windows', {
	id: text('id').primaryKey().$defaultFn(newId),
	seriesId: text('series_id')
		.notNull()
		.references(() => series.id, { onDelete: 'cascade' }),
	label: text('label').notNull(),
	startDate: text('start_date').notNull(),
	endDate: text('end_date').notNull(),
	sortOrder: integer('sort_order').notNull()
});

export const holidays = sqliteTable('holidays', {
	date: text('date').primaryKey(),
	label: text('label').notNull()
});

// ── Work ─────────────────────────────────────────────────────────────────────

export const tasks = sqliteTable(
	'tasks',
	{
		id: text('id').primaryKey().$defaultFn(newId),
		bookId: text('book_id')
			.notNull()
			.references(() => books.id, { onDelete: 'cascade' }),
		stageId: text('stage_id').notNull(),
		windowId: text('window_id'),
		scheduleState: text('schedule_state', { enum: ['scheduled', 'unscheduled'] })
			.notNull()
			.default('scheduled'),
		overflowAllowed: integer('overflow_allowed').notNull().default(0), // end may pass its window by series.windowOverflowDays
		title: text('title').notNull(),
		startDate: text('start_date').notNull(),
		endDate: text('end_date').notNull(),
		durationDays: integer('duration_days').notNull(),
		status: text('status', {
			enum: ['not_started', 'in_progress', 'in_review', 'returned', 'done', 'blocked']
		})
			.notNull()
			.default('not_started'),
		statusBeforeBlock: text('status_before_block'),
		blockedReason: text('blocked_reason'),
		iteration: integer('iteration').notNull().default(1),
		feedbackUrl: text('feedback_url'),
		dueDate: text('due_date'),
		notes: text('notes'),
		version: integer('version').notNull().default(1),
		completedAt: text('completed_at'),
		createdAt: text('created_at').notNull(),
		updatedAt: text('updated_at').notNull()
	},
	(t) => [
		index('idx_tasks_book').on(t.bookId),
		index('idx_tasks_window').on(t.windowId),
		index('idx_tasks_dates').on(t.startDate, t.endDate)
	]
);

export const taskAssignees = sqliteTable(
	'task_assignees',
	{
		taskId: text('task_id')
			.notNull()
			.references(() => tasks.id, { onDelete: 'cascade' }),
		personId: text('person_id')
			.notNull()
			.references(() => people.id),
		isLead: integer('is_lead').notNull().default(0)
	},
	(t) => [
		primaryKey({ columns: [t.taskId, t.personId] }),
		index('idx_assignee_person').on(t.personId)
	]
);

export const dependencies = sqliteTable(
	'dependencies',
	{
		id: text('id').primaryKey().$defaultFn(newId),
		predecessorId: text('predecessor_id')
			.notNull()
			.references(() => tasks.id, { onDelete: 'cascade' }),
		successorId: text('successor_id')
			.notNull()
			.references(() => tasks.id, { onDelete: 'cascade' }),
		lagDays: integer('lag_days').notNull().default(0)
	},
	(t) => [index('idx_dep_succ').on(t.successorId)]
);

export const reviewCycles = sqliteTable('review_cycles', {
	id: text('id').primaryKey().$defaultFn(newId),
	taskId: text('task_id')
		.notNull()
		.references(() => tasks.id, { onDelete: 'cascade' }),
	iteration: integer('iteration').notNull(),
	reviewerId: text('reviewer_id')
		.notNull()
		.references(() => people.id),
	outcome: text('outcome', { enum: ['approved', 'changes_requested'] }).notNull(),
	comments: text('comments'),
	createdAt: text('created_at').notNull()
});

export const printApprovals = sqliteTable('print_approvals', {
	bookId: text('book_id')
		.primaryKey()
		.references(() => books.id, { onDelete: 'cascade' }),
	approvedBy: text('approved_by')
		.notNull()
		.references(() => people.id),
	approvedAt: text('approved_at').notNull(),
	note: text('note')
});

export const printRecords = sqliteTable('print_records', {
	bookId: text('book_id')
		.primaryKey()
		.references(() => books.id, { onDelete: 'cascade' }),
	copiesPlanned: integer('copies_planned').notNull(),
	depositCopies: integer('deposit_copies').notNull(),
	copiesPrinted: integer('copies_printed').notNull().default(0),
	printedOn: text('printed_on'),
	sentToBinderOn: text('sent_to_binder_on'),
	returnedFromBinderOn: text('returned_from_binder_on'),
	copiesBound: integer('copies_bound').notNull().default(0),
	depositSubmittedOn: text('deposit_submitted_on'),
	binderName: text('binder_name'),
	binderContact: text('binder_contact'),
	notes: text('notes'),
	version: integer('version').notNull().default(1),
	updatedAt: text('updated_at').notNull()
});

export const taskComments = sqliteTable('comments', {
	id: text('id').primaryKey().$defaultFn(newId),
	taskId: text('task_id')
		.notNull()
		.references(() => tasks.id, { onDelete: 'cascade' }),
	authorId: text('author_id')
		.notNull()
		.references(() => people.id),
	body: text('body').notNull(),
	createdAt: text('created_at').notNull()
});

// ── History ────────────────────────────────────────────────────────────────

export const baselines = sqliteTable('baselines', {
	id: text('id').primaryKey().$defaultFn(newId),
	seriesId: text('series_id')
		.notNull()
		.references(() => series.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	createdAt: text('created_at').notNull()
});

export const baselineTasks = sqliteTable(
	'baseline_tasks',
	{
		baselineId: text('baseline_id')
			.notNull()
			.references(() => baselines.id, { onDelete: 'cascade' }),
		taskId: text('task_id')
			.notNull()
			.references(() => tasks.id, { onDelete: 'cascade' }),
		startDate: text('start_date').notNull(),
		endDate: text('end_date').notNull()
	},
	(t) => [primaryKey({ columns: [t.baselineId, t.taskId] })]
);

export const activityLog = sqliteTable(
	'activity_log',
	{
		id: text('id').primaryKey(), // ULID set explicitly — doubles as polling cursor
		seriesId: text('series_id'), // null for global changes (people, holidays)
		actorId: text('actor_id'),
		entity: text('entity', {
			enum: [
				'series', 'template', 'track', 'stage', 'stage_link', 'skip', 'book', 'task', 'dependency',
				'window', 'holiday', 'member', 'person', 'invite', 'review',
				'approval', 'print_record', 'comment', 'baseline'
			]
		}).notNull(),
		entityId: text('entity_id').notNull(),
		action: text('action').notNull(),
		beforeJson: text('before_json'),
		afterJson: text('after_json'),
		batchId: text('batch_id'),
		revertsBatchId: text('reverts_batch_id'), // on undo and redo entries: the batch they reverse
		createdAt: text('created_at').notNull()
	},
	(t) => [
		index('idx_log_feed').on(t.seriesId, t.id),
		index('idx_log_entity').on(t.entity, t.entityId),
		index('idx_log_batch').on(t.actorId, t.seriesId, t.batchId),
		index('idx_log_reverts').on(t.revertsBatchId)
	]
);
