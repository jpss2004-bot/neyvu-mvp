BEGIN;
ALTER TABLE schoolvault.worker_status ADD COLUMN capabilities jsonb NOT NULL DEFAULT '{}';
COMMIT;
