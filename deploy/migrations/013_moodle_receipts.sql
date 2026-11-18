BEGIN;
CREATE TABLE schoolvault.moodle_receipts (
 user_id uuid NOT NULL,id uuid NOT NULL,source_id uuid NOT NULL,version_id uuid NOT NULL,device_id uuid NOT NULL,
 identity_key text NOT NULL CHECK(identity_key ~ '^[1-9][0-9]{0,11}$'),
 activity_url text NOT NULL CHECK(activity_url ~ '^https://moodle\.acadiau\.ca/mod/(assign|quiz)/view\.php\?id=[1-9][0-9]{0,11}$'),
 body_sha256 text NOT NULL CHECK(body_sha256 ~ '^[a-f0-9]{64}$'),
 captured_at timestamptz NOT NULL,received_at timestamptz NOT NULL DEFAULT now(),
 state text NOT NULL CHECK(state IN('submitted','draft','no_submission','reopened','group_submission','attempt_finished','attempt_in_progress','attempt_overdue','attempt_abandoned','unknown','conflict')),
 reason text NOT NULL CHECK(length(reason)<=400),proof jsonb,
 provenance text NOT NULL CHECK(provenance IN('signed_in_capture','synthetic_capture')),
 PRIMARY KEY(user_id,id),UNIQUE(user_id,source_id,captured_at),
 FOREIGN KEY(user_id,source_id,version_id) REFERENCES schoolvault.source_versions(user_id,source_id,id),
 FOREIGN KEY(user_id,device_id) REFERENCES schoolvault.companion_devices(user_id,id)
);
CREATE INDEX moodle_receipts_latest ON schoolvault.moodle_receipts(user_id,source_id,captured_at DESC);
ALTER TABLE schoolvault.moodle_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE schoolvault.moodle_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY moodle_receipts_tenant ON schoolvault.moodle_receipts USING(user_id=nullif(current_setting('schoolvault.user_id',true),'')::uuid) WITH CHECK(user_id=nullif(current_setting('schoolvault.user_id',true),'')::uuid);
GRANT SELECT,INSERT ON schoolvault.moodle_receipts TO schoolvault_web;
COMMIT;
