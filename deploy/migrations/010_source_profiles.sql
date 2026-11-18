BEGIN;
ALTER TABLE schoolvault.users ADD COLUMN last_profile_lease_at timestamptz;
CREATE TABLE schoolvault.source_profiles (
 user_id uuid NOT NULL,
 source_id uuid NOT NULL,
 version_id uuid NOT NULL,
 body_sha256 text NOT NULL CHECK(body_sha256 ~ '^[a-f0-9]{64}$'),
 characters integer NOT NULL CHECK(characters BETWEEN 1 AND 160000),
 cursor integer NOT NULL DEFAULT 0 CHECK(cursor>=0 AND cursor<=characters),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','reading','partial','ready','failed','stale')),
 algorithm text NOT NULL DEFAULT 'source-profile-v1' CHECK(algorithm='source-profile-v1'),
 data jsonb NOT NULL DEFAULT '{"facts":[],"sections":0,"issues":[]}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,source_id,version_id),
 FOREIGN KEY(user_id,source_id,version_id) REFERENCES schoolvault.source_versions(user_id,source_id,id)
);
ALTER TABLE schoolvault.source_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE schoolvault.source_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY source_profiles_tenant ON schoolvault.source_profiles USING(user_id=nullif(current_setting('schoolvault.user_id',true),'')::uuid) WITH CHECK(user_id=nullif(current_setting('schoolvault.user_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON schoolvault.source_profiles TO schoolvault_web;
CREATE UNIQUE INDEX source_profile_job ON schoolvault.jobs(user_id,(input->>'version_id')) WHERE kind='summary' AND input->>'task'='source-profile-v1';
COMMIT;
