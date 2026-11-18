BEGIN;
ALTER TABLE schoolvault.users ADD COLUMN last_answer_lease_at timestamptz;
ALTER TABLE schoolvault.users ADD COLUMN last_extract_lease_at timestamptz;
COMMIT;
