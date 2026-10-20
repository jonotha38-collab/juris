CREATE TABLE job_candidates (
 owner TEXT NOT NULL,
 job_id TEXT NOT NULL,
 cnj TEXT NOT NULL,
 raw TEXT NOT NULL,
 check_page INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(owner,job_id,cnj)
);
--> statement-breakpoint
ALTER TABLE jobs ADD COLUMN pending_page TEXT;
--> statement-breakpoint
CREATE TABLE inactive_activity_checks (
 owner TEXT NOT NULL,
 cnj TEXT NOT NULL,
 checked_day TEXT NOT NULL,
 PRIMARY KEY(owner,cnj)
);
