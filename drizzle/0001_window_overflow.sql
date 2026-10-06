ALTER TABLE `series` ADD `window_overflow_days` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `overflow_allowed` integer DEFAULT 0 NOT NULL;