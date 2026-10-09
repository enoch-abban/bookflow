-- System roles (spec: Users, roles and permissions): is_admin becomes system_role.
-- Existing admins stay admins; everyone else is a member.
ALTER TABLE `people` ADD `system_role` text DEFAULT 'member' NOT NULL;--> statement-breakpoint
UPDATE `people` SET `system_role` = 'admin' WHERE `is_admin` = 1;--> statement-breakpoint
ALTER TABLE `people` DROP COLUMN `is_admin`;
