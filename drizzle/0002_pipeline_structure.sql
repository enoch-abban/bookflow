CREATE TABLE `book_stage_skips` (
	`book_id` text NOT NULL,
	`stage_id` text NOT NULL,
	PRIMARY KEY(`book_id`, `stage_id`),
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`stage_id`) REFERENCES `stages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `stage_links` (
	`from_stage_id` text NOT NULL,
	`to_stage_id` text NOT NULL,
	`lag_days` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`from_stage_id`, `to_stage_id`),
	FOREIGN KEY (`from_stage_id`) REFERENCES `stages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_stage_id`) REFERENCES `stages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `books` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `stages` ADD `archived_at` text;