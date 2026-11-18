BEGIN;
ALTER TABLE schoolvault.student_plans DROP CONSTRAINT student_plans_kind_check;
ALTER TABLE schoolvault.student_plans DROP CONSTRAINT student_plans_check;
ALTER TABLE schoolvault.student_plans ADD CHECK(kind IN('project','milestone','class_action'));
ALTER TABLE schoolvault.student_plans ADD CHECK((kind IN('project','class_action') AND parent_id IS NULL) OR (kind='milestone' AND parent_id IS NOT NULL));
ALTER TABLE schoolvault.student_plans ADD COLUMN class_evidence jsonb,ADD COLUMN class_review jsonb;
ALTER TABLE schoolvault.student_plans ADD CHECK((kind='class_action' AND jsonb_typeof(class_evidence)='object' AND source_id IS NOT NULL) OR (kind!='class_action' AND class_evidence IS NULL AND class_review IS NULL));
ALTER TABLE schoolvault.student_plans ADD CHECK(class_review IS NULL OR jsonb_typeof(class_review)='object');
CREATE UNIQUE INDEX class_action_identity ON schoolvault.student_plans(user_id,(class_evidence->>'session_id'),(class_evidence->>'key')) WHERE kind='class_action';
CREATE TABLE schoolvault.class_action_revisions (
 user_id uuid NOT NULL,id uuid NOT NULL,plan_id uuid NOT NULL,binding text NOT NULL CHECK(binding ~ '^[a-f0-9]{64}$'),
 evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object'),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,id),UNIQUE(user_id,plan_id,binding),
 FOREIGN KEY(user_id,plan_id) REFERENCES schoolvault.student_plans(user_id,id)
);
ALTER TABLE schoolvault.class_action_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE schoolvault.class_action_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY class_action_revisions_tenant ON schoolvault.class_action_revisions USING(user_id=nullif(current_setting('schoolvault.user_id',true),'')::uuid) WITH CHECK(user_id=nullif(current_setting('schoolvault.user_id',true),'')::uuid);
GRANT SELECT,INSERT ON schoolvault.class_action_revisions TO schoolvault_web;
ALTER TABLE schoolvault.class_sessions ADD COLUMN actions_summary jsonb,ADD COLUMN actions_state text NOT NULL DEFAULT 'waiting' CHECK(actions_state IN('waiting','prepared','paused','held'));
ALTER TABLE schoolvault.users ADD COLUMN last_class_action_at timestamptz;
COMMIT;
