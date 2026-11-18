BEGIN;
CREATE TABLE schoolvault.citation_preferences (
 user_id uuid NOT NULL, course_id uuid NOT NULL, style text NOT NULL CHECK(style IN ('apa','mla','chicago')),
 revision integer NOT NULL CHECK(revision>0), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,course_id), FOREIGN KEY(user_id,course_id) REFERENCES schoolvault.courses(user_id,id)
);
CREATE TABLE schoolvault.citation_metadata (
 user_id uuid NOT NULL, source_id uuid NOT NULL, version_id uuid NOT NULL, revision integer NOT NULL CHECK(revision>0),
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'), provenance text NOT NULL DEFAULT 'student-corrected' CHECK(provenance='student-corrected'),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,source_id,version_id,revision),
 FOREIGN KEY(user_id,source_id,version_id) REFERENCES schoolvault.source_versions(user_id,source_id,id)
);
ALTER TABLE schoolvault.citation_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE schoolvault.citation_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY citation_preferences_tenant ON schoolvault.citation_preferences USING(user_id=nullif(current_setting('schoolvault.user_id',true),'')::uuid) WITH CHECK(user_id=nullif(current_setting('schoolvault.user_id',true),'')::uuid);
ALTER TABLE schoolvault.citation_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE schoolvault.citation_metadata FORCE ROW LEVEL SECURITY;
CREATE POLICY citation_metadata_tenant ON schoolvault.citation_metadata USING(user_id=nullif(current_setting('schoolvault.user_id',true),'')::uuid) WITH CHECK(user_id=nullif(current_setting('schoolvault.user_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON schoolvault.citation_preferences TO schoolvault_web;
GRANT SELECT,INSERT,DELETE ON schoolvault.citation_metadata TO schoolvault_web;
COMMIT;
