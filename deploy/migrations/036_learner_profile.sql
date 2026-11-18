BEGIN;
-- D7 learner profile (build/knowledge, 2026-11-12). Account-level facts the
-- learner can see and edit: program, year, preferences, per-course section.
-- Course group corrections stay in student_memory (009); this table holds the
-- other profile fields. Every row carries its authority, so a student-reported
-- fact is never presented as platform-verified.
CREATE TABLE schoolvault.learner_profile_facts (
 user_id uuid NOT NULL REFERENCES schoolvault.users(id),
 id uuid NOT NULL,
 field text NOT NULL CHECK(field IN ('program','year_of_study','language','answer_length','explanation_style','section','timezone','accessibility')),
 course_id uuid,
 value text NOT NULL CHECK(length(value) BETWEEN 1 AND 400),
 authority text NOT NULL CHECK(authority IN ('student_reported','platform_verified')),
 -- Where a platform-verified value came from (connector record id); null for student reports.
 proof_ref text CHECK(proof_ref IS NULL OR length(proof_ref)<=400),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,id),
 CHECK(authority<>'platform_verified' OR proof_ref IS NOT NULL),
 CHECK((field='section')=(course_id IS NOT NULL)),
 FOREIGN KEY(user_id,course_id) REFERENCES schoolvault.courses(user_id,id)
);
CREATE UNIQUE INDEX learner_profile_one ON schoolvault.learner_profile_facts(user_id,field,coalesce(course_id,'00000000-0000-0000-0000-000000000000'::uuid),authority);
ALTER TABLE schoolvault.learner_profile_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE schoolvault.learner_profile_facts FORCE ROW LEVEL SECURITY;
CREATE POLICY learner_profile_facts_tenant ON schoolvault.learner_profile_facts USING(user_id=nullif(current_setting('schoolvault.user_id',true),'')::uuid) WITH CHECK(user_id=nullif(current_setting('schoolvault.user_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON schoolvault.learner_profile_facts TO schoolvault_web;
COMMIT;
