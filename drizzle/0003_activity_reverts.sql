ALTER TABLE `activity_log` ADD `reverts_batch_id` text;--> statement-breakpoint
CREATE INDEX `idx_log_reverts` ON `activity_log` (`reverts_batch_id`);