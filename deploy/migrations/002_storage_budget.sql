BEGIN;
-- A single shared byte counter contains no user IDs, file names or course data.
CREATE TABLE schoolvault.storage_budget (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), used_bytes bigint NOT NULL DEFAULT 0 CHECK(used_bytes>=0),
 limit_bytes bigint NOT NULL DEFAULT 4294967296 CHECK(limit_bytes>0)
);
INSERT INTO schoolvault.storage_budget(id) VALUES(true);
GRANT SELECT,UPDATE ON schoolvault.storage_budget TO schoolvault_web;
REVOKE INSERT,UPDATE,DELETE ON schoolvault.schema_migrations FROM schoolvault_web;
REVOKE UPDATE,DELETE ON schoolvault.source_versions,schoolvault.passages,schoolvault.note_revisions,schoolvault.audit FROM schoolvault_web;
COMMIT;
