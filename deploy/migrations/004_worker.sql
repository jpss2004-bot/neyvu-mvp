BEGIN;
CREATE TABLE schoolvault.worker_status (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), checked_at timestamptz
);
INSERT INTO schoolvault.worker_status(id) VALUES(true);
GRANT SELECT,UPDATE ON schoolvault.worker_status TO schoolvault_web;
COMMIT;
