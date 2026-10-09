CREATE TABLE `admin_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`from_person_id` text NOT NULL,
	`to_person_id` text NOT NULL,
	`sender_new_role` text DEFAULT 'manager' NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`accepted_at` text,
	`cancelled_at` text,
	FOREIGN KEY (`from_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "transfer_not_self" CHECK("admin_transfers"."from_person_id" <> "admin_transfers"."to_person_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_transfers_token_hash_unique` ON `admin_transfers` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_transfers_from` ON `admin_transfers` (`from_person_id`);--> statement-breakpoint
CREATE INDEX `idx_transfers_to` ON `admin_transfers` (`to_person_id`);