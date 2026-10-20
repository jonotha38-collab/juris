CREATE TABLE ai_config (
 owner text PRIMARY KEY NOT NULL,
 key_cipher text,
 enabled integer NOT NULL DEFAULT 0,
 automatic integer NOT NULL DEFAULT 1,
 daily_limit integer NOT NULL DEFAULT 200000,
 version integer NOT NULL DEFAULT 1,
 updated text NOT NULL
);
--> statement-breakpoint
CREATE TABLE ai_usage (
 owner text NOT NULL,
 day text NOT NULL,
 charged_tokens integer NOT NULL DEFAULT 0,
 input_tokens integer NOT NULL DEFAULT 0,
 output_tokens integer NOT NULL DEFAULT 0,
 calls integer NOT NULL DEFAULT 0,
 PRIMARY KEY(owner,day)
);
--> statement-breakpoint
CREATE TABLE ai_jobs (
 owner text NOT NULL,
 cnj text NOT NULL,
 status text NOT NULL DEFAULT 'queued',
 lease_until integer NOT NULL DEFAULT 0,
 error_code text NOT NULL DEFAULT '',
 retry_at integer NOT NULL DEFAULT 0,
 updated text NOT NULL,
 PRIMARY KEY(owner,cnj)
);
--> statement-breakpoint
CREATE INDEX ai_jobs_queue ON ai_jobs(owner,status,retry_at,updated);
--> statement-breakpoint
CREATE TABLE ai_checks (
 owner text NOT NULL,
 publication_id text NOT NULL,
 source_version integer NOT NULL,
 next_offset integer NOT NULL DEFAULT 0,
 complete integer NOT NULL DEFAULT 0,
 updated text NOT NULL,
 PRIMARY KEY(owner,publication_id,source_version)
);
--> statement-breakpoint
CREATE TABLE ai_suggestions (
 id text PRIMARY KEY NOT NULL,
 owner text NOT NULL,
 cnj text NOT NULL,
 publication_id text NOT NULL,
 source_version integer NOT NULL,
 fingerprint text NOT NULL,
 category text NOT NULL,
 title text NOT NULL,
 description text NOT NULL,
 excerpt text NOT NULL,
 due_date text,
 period text,
 priority text NOT NULL DEFAULT 'normal',
 status text NOT NULL DEFAULT 'pending',
 version integer NOT NULL DEFAULT 1,
 task_id text,
 decided_by text,
 decision_note text NOT NULL DEFAULT '',
 decision_token text,
 decided_at text,
 created text NOT NULL,
 updated text NOT NULL,
 UNIQUE(owner,publication_id,source_version,fingerprint)
);
--> statement-breakpoint
CREATE INDEX ai_suggestions_queue ON ai_suggestions(owner,status,cnj,due_date);
--> statement-breakpoint
CREATE INDEX ai_suggestions_task ON ai_suggestions(owner,task_id);
--> statement-breakpoint
CREATE TABLE ai_runs (
 id text PRIMARY KEY NOT NULL,
 owner text NOT NULL,
 cnj text NOT NULL,
 model text NOT NULL,
 status text NOT NULL,
 error_code text NOT NULL DEFAULT '',
 reserved_tokens integer NOT NULL,
 input_tokens integer NOT NULL DEFAULT 0,
 output_tokens integer NOT NULL DEFAULT 0,
 coverage text NOT NULL DEFAULT '{}',
 summary text NOT NULL DEFAULT '',
 created text NOT NULL,
 updated text NOT NULL
);
--> statement-breakpoint
CREATE INDEX ai_runs_case ON ai_runs(owner,cnj,created);
--> statement-breakpoint
ALTER TABLE tasks ADD origin text NOT NULL DEFAULT 'manual';
--> statement-breakpoint
ALTER TABLE tasks ADD ai_suggestion_id text;
--> statement-breakpoint
INSERT INTO ai_jobs(owner,cnj,updated) SELECT owner,cnj,MAX(updated) FROM publications GROUP BY owner,cnj;
--> statement-breakpoint
CREATE TRIGGER ai_publication_insert AFTER INSERT ON publications BEGIN
 INSERT INTO ai_jobs(owner,cnj,status,updated) VALUES(NEW.owner,NEW.cnj,'queued',NEW.updated)
 ON CONFLICT(owner,cnj) DO UPDATE SET status=CASE WHEN ai_jobs.lease_until>0 THEN ai_jobs.status ELSE 'queued' END,error_code='',retry_at=0,updated=excluded.updated;
END;
--> statement-breakpoint
CREATE TRIGGER ai_publication_change AFTER UPDATE OF text,date,type,hash,canceled,cnj,tribunal,organ,raw ON publications
 WHEN OLD.text IS NOT NEW.text OR OLD.date IS NOT NEW.date OR OLD.type IS NOT NEW.type
 OR OLD.hash IS NOT NEW.hash OR OLD.canceled IS NOT NEW.canceled OR OLD.cnj IS NOT NEW.cnj
 OR OLD.tribunal IS NOT NEW.tribunal OR OLD.organ IS NOT NEW.organ OR OLD.raw IS NOT NEW.raw
 BEGIN
 INSERT INTO ai_jobs(owner,cnj,status,updated) VALUES(NEW.owner,NEW.cnj,'queued',NEW.updated)
 ON CONFLICT(owner,cnj) DO UPDATE SET status=CASE WHEN ai_jobs.lease_until>0 THEN ai_jobs.status ELSE 'queued' END,error_code='',retry_at=0,updated=excluded.updated;
END;
