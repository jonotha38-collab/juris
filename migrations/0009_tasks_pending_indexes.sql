CREATE INDEX tasks_owner_case_status_due ON tasks(owner,cnj,status,due_date);
--> statement-breakpoint
CREATE INDEX tasks_owner_assignee_status_due ON tasks(owner,assignee_id,status,due_date);
