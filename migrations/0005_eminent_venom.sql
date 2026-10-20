CREATE TABLE `client_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`client_id` text NOT NULL,
	`cnj` text NOT NULL,
	`publication_id` text NOT NULL,
	`phone` text NOT NULL,
	`message` text NOT NULL,
	`status` text DEFAULT 'prepared' NOT NULL,
	`created_by` text NOT NULL,
	`created_name` text NOT NULL,
	`created` text NOT NULL,
	`confirmed_at` text,
	`confirmed_by` text,
	`confirmed_name` text
);
--> statement-breakpoint
CREATE INDEX `client_messages_owner_client` ON `client_messages` (`owner`,`client_id`,`created`);--> statement-breakpoint
CREATE INDEX `client_messages_publication_status` ON `client_messages` (`owner`,`client_id`,`publication_id`,`status`);--> statement-breakpoint
CREATE TABLE `client_processes` (
	`owner` text NOT NULL,
	`client_id` text NOT NULL,
	`cnj` text NOT NULL,
	`created` text NOT NULL,
	PRIMARY KEY(`owner`, `client_id`, `cnj`)
);
--> statement-breakpoint
CREATE INDEX `client_processes_owner_cnj` ON `client_processes` (`owner`,`cnj`);--> statement-breakpoint
CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`whatsapp` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `clients_owner_name` ON `clients` (`owner`,`archived`,`name`);