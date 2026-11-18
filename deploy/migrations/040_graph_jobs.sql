BEGIN;
-- Automatic knowledge-graph extraction (build/intelligence, 2026-11-12).
-- Saving a source version queues one 'graph' job per course; the worker
-- leases it, runs the deterministic and (optionally) local-model extractors
-- over the course's current versions, and the server re-checks every proof
-- and quote before storing (lib/beta/graph-jobs.ts). Only queued while
-- SCHOOL_BETA_KNOWLEDGE_GRAPH=1.
ALTER TABLE schoolvault.jobs DROP CONSTRAINT jobs_kind_check;
ALTER TABLE schoolvault.jobs ADD CONSTRAINT jobs_kind_check CHECK(kind IN ('answer','summary','transcribe','extract','collect','graph'));
-- At most one waiting extraction per course: later saves join it.
CREATE UNIQUE INDEX graph_job_queued ON schoolvault.jobs(user_id,(input->>'course_id')) WHERE kind='graph' AND status='queued';
CREATE INDEX graph_job_lease ON schoolvault.jobs(created_at) WHERE kind='graph' AND status IN ('queued','leased');
COMMIT;
