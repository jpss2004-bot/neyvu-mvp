BEGIN;
ALTER TABLE schoolvault.vaults ADD COLUMN reading_blocked_reason text CHECK(reading_blocked_reason IN('history_limit','reading_history_limit'));
ALTER TABLE schoolvault.source_profiles DROP CONSTRAINT source_profiles_state_check;
ALTER TABLE schoolvault.source_profiles ADD CONSTRAINT source_profiles_state_check CHECK(state IN('queued','reading','partial','ready','failed','stale','paused'));
COMMIT;
