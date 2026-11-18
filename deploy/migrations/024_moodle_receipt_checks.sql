BEGIN;
-- Retain all immutable receipts; only repeated-check timestamps are mutable.
ALTER TABLE schoolvault.moodle_receipts ADD CONSTRAINT moodle_receipts_source_id_unique UNIQUE(user_id,source_id,id);
CREATE TABLE schoolvault.moodle_receipt_checks (
 user_id uuid NOT NULL,source_id uuid NOT NULL,receipt_id uuid NOT NULL,
 captured_at timestamptz NOT NULL,received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(user_id,source_id),
 FOREIGN KEY(user_id,source_id,receipt_id) REFERENCES schoolvault.moodle_receipts(user_id,source_id,id)
);
ALTER TABLE schoolvault.moodle_receipt_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE schoolvault.moodle_receipt_checks FORCE ROW LEVEL SECURITY;
CREATE POLICY moodle_receipt_checks_tenant ON schoolvault.moodle_receipt_checks USING(user_id=nullif(current_setting('schoolvault.user_id',true),'')::uuid) WITH CHECK(user_id=nullif(current_setting('schoolvault.user_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE ON schoolvault.moodle_receipt_checks TO schoolvault_web;
COMMIT;
