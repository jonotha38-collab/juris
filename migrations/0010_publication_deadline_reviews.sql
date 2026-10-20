CREATE TABLE publication_reviews (
 owner text NOT NULL,
 publication_id text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','dismissed')),
 version integer NOT NULL DEFAULT 1,
 source_version integer NOT NULL DEFAULT 1,
 reviewer_id text,
 reviewer_name text,
 reviewed_at text,
 reason text NOT NULL DEFAULT '',
 resolution_id text,
 created text NOT NULL,
 updated text NOT NULL,
 PRIMARY KEY (owner,publication_id)
);
--> statement-breakpoint
CREATE INDEX publication_reviews_queue ON publication_reviews(owner,status,updated,publication_id);
--> statement-breakpoint
CREATE TABLE deadline_task_links (
 owner text NOT NULL,
 publication_id text NOT NULL,
 task_id text NOT NULL,
 source_version integer NOT NULL,
 details text NOT NULL DEFAULT '{}',
 created text NOT NULL,
 PRIMARY KEY(owner,task_id)
);
--> statement-breakpoint
CREATE INDEX deadline_task_links_publication ON deadline_task_links(owner,publication_id,created);
--> statement-breakpoint
CREATE TABLE publication_review_events (
 id text PRIMARY KEY NOT NULL,
 owner text NOT NULL,
 publication_id text NOT NULL,
 source_version integer NOT NULL,
 actor_id text NOT NULL,
 actor_name text NOT NULL,
 action text NOT NULL,
 data text NOT NULL,
 created text NOT NULL
);
--> statement-breakpoint
CREATE INDEX publication_review_events_source ON publication_review_events(owner,publication_id,created);
--> statement-breakpoint
INSERT INTO publication_reviews(owner,publication_id,created,updated)
 SELECT owner,id,updated,updated FROM publications;
--> statement-breakpoint
CREATE TRIGGER publication_review_insert AFTER INSERT ON publications BEGIN
 INSERT OR IGNORE INTO publication_reviews(owner,publication_id,created,updated)
 VALUES(NEW.owner,NEW.id,NEW.updated,NEW.updated);
END;
--> statement-breakpoint
CREATE TRIGGER publication_review_source_changed
 AFTER UPDATE OF text,date,type,hash,canceled,cnj,tribunal,organ,raw ON publications
 WHEN OLD.text IS NOT NEW.text OR OLD.date IS NOT NEW.date OR OLD.type IS NOT NEW.type
 OR OLD.hash IS NOT NEW.hash OR OLD.canceled IS NOT NEW.canceled OR OLD.cnj IS NOT NEW.cnj
 OR OLD.tribunal IS NOT NEW.tribunal OR OLD.organ IS NOT NEW.organ OR OLD.raw IS NOT NEW.raw
 BEGIN
 UPDATE publication_reviews SET status='pending',version=version+1,source_version=source_version+1,
 reviewer_id=NULL,reviewer_name=NULL,reviewed_at=NULL,reason='',resolution_id=NULL,updated=NEW.updated
 WHERE owner=NEW.owner AND publication_id=NEW.id;
END;
