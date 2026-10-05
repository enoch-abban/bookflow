CREATE TABLE `activity_log` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text,
	`actor_id` text,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`batch_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_log_feed` ON `activity_log` (`series_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_log_entity` ON `activity_log` (`entity`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_log_batch` ON `activity_log` (`actor_id`,`series_id`,`batch_id`);--> statement-breakpoint
CREATE TABLE `baseline_tasks` (
	`baseline_id` text NOT NULL,
	`task_id` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	PRIMARY KEY(`baseline_id`, `task_id`),
	FOREIGN KEY (`baseline_id`) REFERENCES `baselines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `baselines` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `books` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`track_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`group_label` text,
	`isbn` text,
	`edition` text,
	`batch` integer,
	`sort_order` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `books_isbn_unique` ON `books` (`isbn`);--> statement-breakpoint
CREATE INDEX `idx_books_series` ON `books` (`series_id`);--> statement-breakpoint
CREATE TABLE `dependencies` (
	`id` text PRIMARY KEY NOT NULL,
	`predecessor_id` text NOT NULL,
	`successor_id` text NOT NULL,
	`lag_days` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`predecessor_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`successor_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_dep_succ` ON `dependencies` (`successor_id`);--> statement-breakpoint
CREATE TABLE `holidays` (
	`date` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`email` text NOT NULL,
	`token_hash` text NOT NULL,
	`invited_by` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`accepted_at` text,
	`revoked_at` text,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invited_by`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token_hash_unique` ON `invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_invites_person` ON `invites` (`person_id`);--> statement-breakpoint
CREATE TABLE `people` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`display_name` text NOT NULL,
	`email` text,
	`is_admin` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `people_user_id_unique` ON `people` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `people_email_unique` ON `people` (`email`);--> statement-breakpoint
CREATE TABLE `print_approvals` (
	`book_id` text PRIMARY KEY NOT NULL,
	`approved_by` text NOT NULL,
	`approved_at` text NOT NULL,
	`note` text,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`approved_by`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `print_records` (
	`book_id` text PRIMARY KEY NOT NULL,
	`copies_planned` integer NOT NULL,
	`deposit_copies` integer NOT NULL,
	`copies_printed` integer DEFAULT 0 NOT NULL,
	`printed_on` text,
	`sent_to_binder_on` text,
	`returned_from_binder_on` text,
	`copies_bound` integer DEFAULT 0 NOT NULL,
	`deposit_submitted_on` text,
	`binder_name` text,
	`binder_contact` text,
	`notes` text,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `review_cycles` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`iteration` integer NOT NULL,
	`reviewer_id` text NOT NULL,
	`outcome` text NOT NULL,
	`comments` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewer_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `series` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`template_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`start_date` text NOT NULL,
	`target_date` text NOT NULL,
	`hard_limit_date` text,
	`book_group_label` text DEFAULT 'Group' NOT NULL,
	`enforce_windows` integer DEFAULT 0 NOT NULL,
	`strict_mode` integer DEFAULT 0 NOT NULL,
	`default_copies` integer DEFAULT 20 NOT NULL,
	`legal_deposit_copies` integer DEFAULT 0 NOT NULL,
	`print_buffer_days` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `series_members` (
	`series_id` text NOT NULL,
	`person_id` text NOT NULL,
	`role` text NOT NULL,
	`team_label` text,
	`capacity` real DEFAULT 1 NOT NULL,
	PRIMARY KEY(`series_id`, `person_id`),
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `stage_tracks` (
	`stage_id` text NOT NULL,
	`track_id` text NOT NULL,
	PRIMARY KEY(`stage_id`, `track_id`),
	FOREIGN KEY (`stage_id`) REFERENCES `stages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `stages` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`sort_order` integer NOT NULL,
	`default_days` integer DEFAULT 1 NOT NULL,
	`is_review` integer DEFAULT 0 NOT NULL,
	`is_external` integer DEFAULT 0 NOT NULL,
	`ignores_windows` integer DEFAULT 0 NOT NULL,
	`deadline_rule` text,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_stages_series` ON `stages` (`series_id`);--> statement-breakpoint
CREATE TABLE `task_assignees` (
	`task_id` text NOT NULL,
	`person_id` text NOT NULL,
	`is_lead` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`task_id`, `person_id`),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_assignee_person` ON `task_assignees` (`person_id`);--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`stage_id` text NOT NULL,
	`window_id` text,
	`schedule_state` text DEFAULT 'scheduled' NOT NULL,
	`title` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`duration_days` integer NOT NULL,
	`status` text DEFAULT 'not_started' NOT NULL,
	`status_before_block` text,
	`blocked_reason` text,
	`iteration` integer DEFAULT 1 NOT NULL,
	`feedback_url` text,
	`due_date` text,
	`notes` text,
	`version` integer DEFAULT 1 NOT NULL,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_tasks_book` ON `tasks` (`book_id`);--> statement-breakpoint
CREATE INDEX `idx_tasks_window` ON `tasks` (`window_id`);--> statement-breakpoint
CREATE INDEX `idx_tasks_dates` ON `tasks` (`start_date`,`end_date`);--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`definition_json` text NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_tracks_series` ON `tracks` (`series_id`);--> statement-breakpoint
CREATE TABLE `windows` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`label` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);