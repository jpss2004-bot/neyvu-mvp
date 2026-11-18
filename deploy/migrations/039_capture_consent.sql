BEGIN;
-- E5 lecture capture with consent (trust pack: docs/trust/lecture-recording-consent-policy.md).
-- Capture stays off globally (SCHOOL_BETA_CLASS_CAPTURE) and per course: a course can be
-- recorded only while the learner holds an active attestation for it. Audio is deleted
-- after transcription unless an operator explicitly retains it. Anyone can file a takedown.

CREATE TABLE schoolvault.class_capture_consents (
 user_id uuid NOT NULL, id uuid NOT NULL, course_id uuid NOT NULL,
 basis text NOT NULL CHECK(basis IN ('instructor_permission','registered_accommodation')),
 -- Instructor permission: who gave it and when. Accommodation: no medical or disability
 -- detail is collected, only that an accommodation is registered with the institution.
 instructor_name text CHECK(instructor_name IS NULL OR length(instructor_name) BETWEEN 1 AND 160),
 permission_date date,
 terms_version text NOT NULL CHECK(terms_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
 personal_use_ack boolean NOT NULL CHECK(personal_use_ack),
 classmates_ack boolean NOT NULL CHECK(classmates_ack),
 attested_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
 PRIMARY KEY(user_id,id),
 FOREIGN KEY(user_id,course_id) REFERENCES schoolvault.courses(user_id,id),
 CHECK(basis<>'instructor_permission' OR (instructor_name IS NOT NULL AND permission_date IS NOT NULL))
);
CREATE UNIQUE INDEX one_active_capture_consent ON schoolvault.class_capture_consents(user_id,course_id) WHERE revoked_at IS NULL;
ALTER TABLE schoolvault.class_sessions ADD COLUMN consent_id uuid;
ALTER TABLE schoolvault.class_sessions ADD COLUMN audio_deleted_at timestamptz;
ALTER TABLE schoolvault.class_sessions ADD COLUMN taken_down_at timestamptz;
GRANT UPDATE(audio_deleted_at,taken_down_at) ON schoolvault.class_sessions TO schoolvault_web;
ALTER TABLE schoolvault.class_sessions ADD FOREIGN KEY(user_id,consent_id) REFERENCES schoolvault.class_capture_consents(user_id,id);

ALTER TABLE schoolvault.class_capture_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE schoolvault.class_capture_consents FORCE ROW LEVEL SECURITY;
CREATE POLICY own_rows ON schoolvault.class_capture_consents TO schoolvault_web USING (user_id=schoolvault.actor_id()) WITH CHECK (user_id=schoolvault.actor_id());
GRANT SELECT,INSERT,UPDATE(revoked_at) ON schoolvault.class_capture_consents TO schoolvault_web;
-- Deleting audio removes chunk rows (the session keeps its manifest hash as provenance).
GRANT DELETE ON schoolvault.class_audio_chunks TO schoolvault_web;

-- Takedown requests from instructors, classmates or the learner. No account needed; the
-- runtime role can insert but never read them back. Operators review them directly.
CREATE TABLE schoolvault.capture_takedown_requests (
 id uuid PRIMARY KEY,
 requester_role text NOT NULL CHECK(requester_role IN ('instructor','classmate','learner','institution','other')),
 contact text NOT NULL CHECK(length(contact) BETWEEN 3 AND 254),
 course text NOT NULL CHECK(length(course) BETWEEN 1 AND 200),
 class_date date, details text NOT NULL DEFAULT '' CHECK(length(details)<=4000),
 status text NOT NULL DEFAULT 'received' CHECK(status IN ('received','actioned','declined')),
 created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz, resolution text
);
GRANT INSERT ON schoolvault.capture_takedown_requests TO schoolvault_web;

-- Sessions whose transcript is saved but whose audio still exists. Ids only, for the purge.
GRANT USAGE,CREATE ON SCHEMA schoolvault TO schoolvault_definer;
CREATE POLICY definer_lookup ON schoolvault.class_sessions TO schoolvault_definer USING (true);
GRANT SELECT(user_id,id,current_transcript,audio_deleted_at,state,consent_id) ON schoolvault.class_sessions TO schoolvault_definer;
CREATE FUNCTION schoolvault.class_audio_pending_purge(max_rows int) RETURNS TABLE(user_id uuid,session_id uuid)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
 SELECT s.user_id,s.id FROM schoolvault.class_sessions s
 WHERE s.state='sealed' AND s.current_transcript IS NOT NULL AND s.audio_deleted_at IS NULL AND s.consent_id IS NOT NULL LIMIT least(max_rows,500)
$$;
ALTER FUNCTION schoolvault.class_audio_pending_purge(int) OWNER TO schoolvault_definer;
REVOKE ALL ON FUNCTION schoolvault.class_audio_pending_purge(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION schoolvault.class_audio_pending_purge(int) TO schoolvault_web;
REVOKE CREATE ON SCHEMA schoolvault FROM schoolvault_definer;
COMMIT;
