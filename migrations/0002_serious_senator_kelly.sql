CREATE TABLE `auth_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`hits` integer NOT NULL,
	`reset_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `process_meta` (
	`owner` text NOT NULL,
	`cnj` text NOT NULL,
	`favorite` integer DEFAULT 0 NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`updated` text NOT NULL,
	PRIMARY KEY(`owner`, `cnj`)
);
