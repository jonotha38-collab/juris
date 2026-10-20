CREATE INDEX `jobs_owner_created` ON `jobs` (`owner`,`created`);--> statement-breakpoint
CREATE INDEX `jobs_pending` ON `jobs` (`status`,`updated`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_one_running_monitor` ON `jobs` (`monitor_id`) WHERE "jobs"."status" = 'running';--> statement-breakpoint
CREATE INDEX `monitors_due` ON `monitors` (`enabled`,`next_run`);--> statement-breakpoint
CREATE INDEX `publications_owner_date` ON `publications` (`owner`,`date`);--> statement-breakpoint
CREATE INDEX `publications_owner_cnj` ON `publications` (`owner`,`cnj`);