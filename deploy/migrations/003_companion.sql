BEGIN;
-- Hashed authentication locators, like sessions: no Moodle credentials or content.
CREATE TABLE schoolvault.companion_devices (
 user_id uuid NOT NULL REFERENCES schoolvault.users(id), id uuid NOT NULL,
 label text NOT NULL, moodle_identity text, created_at timestamptz NOT NULL DEFAULT now(),
 checked_at timestamptz, status text NOT NULL DEFAULT 'waiting', revoked_at timestamptz,
 PRIMARY KEY(user_id,id)
);
CREATE TABLE schoolvault.companion_pairings (
 code_hash text PRIMARY KEY CHECK(length(code_hash)=64), user_id uuid NOT NULL REFERENCES schoolvault.users(id),
 label text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE schoolvault.companion_tokens (
 token_hash text PRIMARY KEY CHECK(length(token_hash)=64), user_id uuid NOT NULL,
 device_id uuid NOT NULL, expires_at timestamptz NOT NULL,
 FOREIGN KEY(user_id,device_id) REFERENCES schoolvault.companion_devices(user_id,id)
);
CREATE TABLE schoolvault.moodle_observations (
 user_id uuid NOT NULL, source_id uuid NOT NULL, device_id uuid NOT NULL,
 captured_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
 coverage jsonb NOT NULL,
 PRIMARY KEY(user_id,source_id),
 FOREIGN KEY(user_id,source_id) REFERENCES schoolvault.sources(user_id,id),
 FOREIGN KEY(user_id,device_id) REFERENCES schoolvault.companion_devices(user_id,id)
);
CREATE UNIQUE INDEX moodle_source_identity ON schoolvault.sources(user_id,course_id,original_url) WHERE kind='moodle';
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['companion_devices','moodle_observations'] LOOP
  EXECUTE format('ALTER TABLE schoolvault.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE schoolvault.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format($policy$CREATE POLICY own_rows ON schoolvault.%I USING (user_id = nullif(current_setting('schoolvault.user_id',true),'')::uuid) WITH CHECK (user_id = nullif(current_setting('schoolvault.user_id',true),'')::uuid)$policy$,t);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE,DELETE ON schoolvault.companion_devices,schoolvault.companion_pairings,schoolvault.companion_tokens,schoolvault.moodle_observations TO schoolvault_web;
COMMIT;
