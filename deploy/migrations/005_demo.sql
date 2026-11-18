BEGIN;
-- Reviewer demo mode. A demo account is an ordinary tenant under the same forced
-- row-level security; only these markers distinguish it. It holds synthetic data only.
ALTER TABLE schoolvault.users ADD COLUMN demo boolean NOT NULL DEFAULT false;
-- Google subjects are numeric. The reserved prefix keeps demo and Google identities disjoint.
ALTER TABLE schoolvault.users ADD CONSTRAINT users_demo_identity CHECK (demo = (google_sub LIKE 'schoolvault-demo:%'));
-- At most one active demo tenant. A reset disables it and provisions a fresh one;
-- history tables stay append-only, so nothing is deleted.
CREATE UNIQUE INDEX one_active_demo_user ON schoolvault.users(demo) WHERE demo AND disabled_at IS NULL;
-- Sessions record whether they were issued by demo access; a mismatch never authenticates.
ALTER TABLE schoolvault.sessions ADD COLUMN demo boolean NOT NULL DEFAULT false;
-- Optional smaller text-history cap. NULL keeps the standard 32 MiB limit for every real vault.
ALTER TABLE schoolvault.vaults ADD COLUMN text_quota_bytes bigint CHECK(text_quota_bytes>0);
-- Attempt accounting for demo access. Hashed client keys only; no codes, IPs or user data.
CREATE TABLE schoolvault.demo_attempts (
 id uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('code','reset')),
 client_hash text NOT NULL CHECK(length(client_hash)=64), success boolean NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX demo_attempts_recent ON schoolvault.demo_attempts(created_at);
GRANT SELECT,INSERT,DELETE ON schoolvault.demo_attempts TO schoolvault_web;
COMMIT;
