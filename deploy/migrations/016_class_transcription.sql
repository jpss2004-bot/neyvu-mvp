BEGIN;
ALTER TABLE schoolvault.users ADD COLUMN last_transcribe_lease_at timestamptz;
ALTER TABLE schoolvault.class_sessions ADD COLUMN decoded_duration_ms integer CHECK(decoded_duration_ms BETWEEN 1 AND 7200000);
ALTER TABLE schoolvault.class_transcripts ADD COLUMN boundary_evidence jsonb DEFAULT '[]' CHECK(jsonb_typeof(boundary_evidence)='array');
CREATE UNIQUE INDEX class_transcription_job ON schoolvault.jobs(user_id,(input->>'session_id')) WHERE kind='transcribe' AND input->>'task'='class-speech-v1';
COMMIT;
