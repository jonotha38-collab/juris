CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`monitor_id` text NOT NULL,
	`start` text NOT NULL,
	`end` text NOT NULL,
	`cursor` text NOT NULL,
	`page` integer NOT NULL,
	`status` text NOT NULL,
	`processed` integer NOT NULL,
	`created` text NOT NULL,
	`updated` text NOT NULL,
	`error` text NOT NULL,
	`locked_until` integer NOT NULL,
	`retry_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `links` (
	`owner` text NOT NULL,
	`publication_id` text NOT NULL,
	`monitor_id` text NOT NULL,
	PRIMARY KEY(`owner`, `publication_id`, `monitor_id`)
);
--> statement-breakpoint
CREATE TABLE `monitors` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`oab` text NOT NULL,
	`uf` text NOT NULL,
	`enabled` integer NOT NULL,
	`created` text NOT NULL,
	`next_run` text NOT NULL,
	`last_success` text
);
--> statement-breakpoint
CREATE TABLE `publications` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`cnj` text NOT NULL,
	`tribunal` text NOT NULL,
	`date` text NOT NULL,
	`text` text NOT NULL,
	`type` text NOT NULL,
	`organ` text NOT NULL,
	`hash` text NOT NULL,
	`canceled` integer NOT NULL,
	`raw` text NOT NULL,
	`seen` integer NOT NULL,
	`updated` text NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
