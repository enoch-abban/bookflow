CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`series_id` text,
	`task_id` text,
	`kind` text NOT NULL,
	`dedupe_key` text,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	`email_status` text DEFAULT 'pending' NOT NULL,
	`email_attempts` integer DEFAULT 0 NOT NULL,
	`emailed_at` text,
	`read_at` text,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_notifications_person` ON `notifications` (`person_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_notifications_pending` ON `notifications` (`email_status`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_notifications_dedupe` ON `notifications` (`person_id`,`dedupe_key`);--> statement-breakpoint
ALTER TABLE `people` ADD `email_notifications` integer DEFAULT 1 NOT NULL;