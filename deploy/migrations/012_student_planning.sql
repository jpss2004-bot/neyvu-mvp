BEGIN;
ALTER TABLE schoolvault.tasks ADD UNIQUE(user_id,id,source_id);
CREATE TABLE schoolvault.student_progress (
 user_id uuid NOT NULL, task_id uuid NOT NULL, source_id uuid NOT NULL, version_id uuid NOT NULL,
 request_id uuid NOT NULL, revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 state text NOT NULL CHECK(state IN('not_started','in_progress','done','not_applicable')),
 planned_on text CHECK(planned_on ~ '^\d{4}-\d{2}-\d{2}$'),
 next_action text NOT NULL DEFAULT '' CHECK(length(next_action)<=600),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,task_id), UNIQUE(user_id,request_id),
 FOREIGN KEY(user_id,task_id,source_id) REFERENCES schoolvault.tasks(user_id,id,source_id),
 FOREIGN KEY(user_id,source_id,version_id) REFERENCES schoolvault.source_versions(user_id,source_id,id)
);
CREATE TABLE schoolvault.student_plans (
 user_id uuid NOT NULL, id uuid NOT NULL, course_id uuid NOT NULL, parent_id uuid,
 source_id uuid, version_id uuid, request_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN('project','milestone')),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 180),
 next_action text NOT NULL DEFAULT '' CHECK(length(next_action)<=600),
 state text NOT NULL CHECK(state IN('not_started','in_progress','done','archived')),
 planned_on text CHECK(planned_on ~ '^\d{4}-\d{2}-\d{2}$'),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,id), UNIQUE(user_id,request_id), UNIQUE(user_id,id,course_id),
 FOREIGN KEY(user_id,course_id) REFERENCES schoolvault.courses(user_id,id),
 FOREIGN KEY(user_id,parent_id,course_id) REFERENCES schoolvault.student_plans(user_id,id,course_id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(user_id,source_id,course_id) REFERENCES schoolvault.sources(user_id,id,course_id),
 FOREIGN KEY(user_id,source_id,version_id) REFERENCES schoolvault.source_versions(user_id,source_id,id),
 CHECK((kind='project' AND parent_id IS NULL) OR (kind='milestone' AND parent_id IS NOT NULL)),
 CHECK((source_id IS NULL)=(version_id IS NULL))
);
CREATE INDEX student_plans_course ON schoolvault.student_plans(user_id,course_id,planned_on);
ALTER TABLE schoolvault.student_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE schoolvault.student_progress FORCE ROW LEVEL SECURITY;
CREATE POLICY student_progress_tenant ON schoolvault.student_progress USING(user_id=nullif(current_setting('schoolvault.user_id',true),'')::uuid) WITH CHECK(user_id=nullif(current_setting('schoolvault.user_id',true),'')::uuid);
ALTER TABLE schoolvault.student_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE schoolvault.student_plans FORCE ROW LEVEL SECURITY;
CREATE POLICY student_plans_tenant ON schoolvault.student_plans USING(user_id=nullif(current_setting('schoolvault.user_id',true),'')::uuid) WITH CHECK(user_id=nullif(current_setting('schoolvault.user_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON schoolvault.student_progress,schoolvault.student_plans TO schoolvault_web;
COMMIT;
