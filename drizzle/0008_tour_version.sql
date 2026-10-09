-- The tour records which version someone has seen, so new steps can be shown as "What's new".
-- Everyone who finished or skipped the first tour has seen version 1.
ALTER TABLE `people` ADD `tour_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `people` SET `tour_version` = 1 WHERE `tour_done_at` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `people` DROP COLUMN `tour_done_at`;
