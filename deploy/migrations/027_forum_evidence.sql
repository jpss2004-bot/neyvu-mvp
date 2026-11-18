BEGIN;
CREATE TABLE schoolvault.moodle_forum_evidence (
 user_id uuid NOT NULL,id uuid NOT NULL,source_id uuid NOT NULL,version_id uuid NOT NULL,device_id uuid NOT NULL,
 identity_key text NOT NULL,activity_url text NOT NULL,
 body_sha256 text NOT NULL CHECK(body_sha256 ~ '^[a-f0-9]{64}$'),
 proof_sha256 text NOT NULL CHECK(proof_sha256 ~ '^[a-f0-9]{64}$'),
 captured_at timestamptz NOT NULL,received_at timestamptz NOT NULL DEFAULT clock_timestamp(),proof jsonb,
 provenance text NOT NULL CHECK(provenance IN('signed_in_capture','synthetic_capture')),
 PRIMARY KEY(user_id,id),UNIQUE(user_id,source_id,id),UNIQUE(user_id,source_id,captured_at),
 FOREIGN KEY(user_id,source_id,version_id) REFERENCES schoolvault.source_versions(user_id,source_id,id),
 FOREIGN KEY(user_id,device_id) REFERENCES schoolvault.companion_devices(user_id,id)
);
CREATE INDEX moodle_forum_evidence_version ON schoolvault.moodle_forum_evidence(user_id,source_id,version_id,captured_at DESC);
CREATE TABLE schoolvault.moodle_forum_checks (
 user_id uuid NOT NULL,source_id uuid NOT NULL,evidence_id uuid NOT NULL,captured_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),role_times jsonb NOT NULL,
 PRIMARY KEY(user_id,source_id),
 FOREIGN KEY(user_id,source_id,evidence_id) REFERENCES schoolvault.moodle_forum_evidence(user_id,source_id,id)
);
ALTER TABLE schoolvault.moodle_forum_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE schoolvault.moodle_forum_evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE schoolvault.moodle_forum_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE schoolvault.moodle_forum_checks FORCE ROW LEVEL SECURITY;
CREATE POLICY moodle_forum_evidence_tenant ON schoolvault.moodle_forum_evidence USING(user_id=nullif(current_setting('schoolvault.user_id',true),'')::uuid) WITH CHECK(user_id=nullif(current_setting('schoolvault.user_id',true),'')::uuid);
CREATE POLICY moodle_forum_checks_tenant ON schoolvault.moodle_forum_checks USING(user_id=nullif(current_setting('schoolvault.user_id',true),'')::uuid) WITH CHECK(user_id=nullif(current_setting('schoolvault.user_id',true),'')::uuid);
GRANT SELECT,INSERT ON schoolvault.moodle_forum_evidence TO schoolvault_web;
GRANT SELECT,INSERT,UPDATE ON schoolvault.moodle_forum_checks TO schoolvault_web;
COMMIT;
