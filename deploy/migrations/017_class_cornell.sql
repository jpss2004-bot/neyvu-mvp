BEGIN;
ALTER TABLE schoolvault.users ADD COLUMN last_cornell_lease_at timestamptz;
CREATE UNIQUE INDEX class_cornell_binding ON schoolvault.jobs(user_id,(input->>'binding')) WHERE kind='summary' AND input->>'task'='class-cornell-v1';
COMMIT;
