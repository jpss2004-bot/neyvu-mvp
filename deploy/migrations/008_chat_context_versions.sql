BEGIN;
ALTER TABLE schoolvault.chats ADD COLUMN context_versions jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMIT;
