BEGIN;
-- Capture completeness is separate from successful storage of saved bytes.
-- Nullable fields allow restoration of earlier session backups.
ALTER TABLE schoolvault.class_sessions ADD COLUMN capture_outcome text DEFAULT 'unknown' CHECK(capture_outcome IN('unknown','stopped_normally','interrupted'));
ALTER TABLE schoolvault.class_sessions ADD COLUMN duration_basis text DEFAULT 'unknown' CHECK(duration_basis IN('unknown','capture_elapsed','media_metadata','student_reported'));
COMMIT;
