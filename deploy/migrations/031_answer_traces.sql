BEGIN;
-- Workstream B6: one tenant-private trace per answer ("Why this answer").
-- Stores identifiers, scores, guard outcomes and timings; source text stays in
-- passages/source_versions. Insert-only for the runtime role.
CREATE TABLE schoolvault.answer_traces (
 user_id uuid NOT NULL, id uuid NOT NULL, job_id uuid NOT NULL, chat_id uuid,
 question text NOT NULL CHECK(length(question)<=4000),
 rewritten_question text CHECK(length(rewritten_question)<=4000),
 retrieval jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(retrieval)='object'),
 chunks jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(chunks)='array'),
 facts jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(facts)='array'),
 guards jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(guards)='array'),
 model text CHECK(length(model)<=160),
 timings jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(timings)='object'),
 input_tokens integer CHECK(input_tokens>=0), output_tokens integer CHECK(output_tokens>=0),
 cost_usd numeric(12,6) CHECK(cost_usd>=0),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,id), UNIQUE(user_id,job_id),
 FOREIGN KEY(user_id,job_id) REFERENCES schoolvault.jobs(user_id,id)
);
ALTER TABLE schoolvault.answer_traces ENABLE ROW LEVEL SECURITY;
ALTER TABLE schoolvault.answer_traces FORCE ROW LEVEL SECURITY;
CREATE POLICY answer_traces_tenant ON schoolvault.answer_traces USING(user_id=nullif(current_setting('schoolvault.user_id',true),'')::uuid) WITH CHECK(user_id=nullif(current_setting('schoolvault.user_id',true),'')::uuid);
GRANT SELECT,INSERT,DELETE ON schoolvault.answer_traces TO schoolvault_web;
COMMIT;
