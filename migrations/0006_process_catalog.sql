CREATE TABLE process_catalog (
 owner TEXT NOT NULL,
 cnj TEXT NOT NULL,
 title TEXT NOT NULL DEFAULT '',
 tribunal TEXT NOT NULL DEFAULT 'Não informado',
 raw TEXT NOT NULL,
 created TEXT NOT NULL,
 updated TEXT NOT NULL,
 PRIMARY KEY(owner,cnj)
);
--> statement-breakpoint
CREATE TABLE catalog_monitors (
 owner TEXT NOT NULL,
 cnj TEXT NOT NULL,
 monitor_id TEXT NOT NULL,
 PRIMARY KEY(owner,cnj,monitor_id)
);
--> statement-breakpoint
CREATE INDEX catalog_monitors_monitor ON catalog_monitors(owner,monitor_id,cnj);
--> statement-breakpoint
-- A catalog record is a case reference, never a DJEN publication.
CREATE VIEW case_records AS
 SELECT p.owner,p.id,p.cnj,p.tribunal,p.date,p.text,p.type,p.organ,p.hash,p.canceled,p.raw,p.seen,p.updated,0 AS is_import FROM publications p
 UNION ALL
 SELECT c.owner,'catalog:'||c.cnj,c.cnj,
 COALESCE((SELECT p.tribunal FROM publications p WHERE p.owner=c.owner AND p.cnj=c.cnj ORDER BY p.date DESC,p.id DESC LIMIT 1),c.tribunal),
 '',c.title,'Cadastro importado','','',0,c.raw,1,c.updated,1
 FROM process_catalog c;
--> statement-breakpoint
CREATE VIEW case_links AS
 SELECT owner,publication_id,monitor_id,0 AS is_import FROM links
 UNION ALL
 SELECT owner,'catalog:'||cnj,monitor_id,1 FROM catalog_monitors;
