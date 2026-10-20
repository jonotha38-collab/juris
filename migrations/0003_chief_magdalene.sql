ALTER TABLE `monitors` ADD `label` text;--> statement-breakpoint
ALTER TABLE `process_meta` ADD `stage` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
CREATE INDEX `links_owner_monitor` ON `links` (`owner`,`monitor_id`,`publication_id`);