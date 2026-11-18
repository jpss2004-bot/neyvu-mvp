BEGIN;
-- Admissions hold contact details only, never student vault contents.
CREATE TABLE schoolvault.access_requests (
 id uuid PRIMARY KEY, email text UNIQUE NOT NULL CHECK(email=lower(email)),
 name text NOT NULL, acadia_student boolean NOT NULL CHECK(acadia_student),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','declined')),
 created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz, decided_by text
);
CREATE TABLE schoolvault.access_limits (
 kind text NOT NULL, bucket text NOT NULL, window_at timestamptz NOT NULL,
 attempts integer NOT NULL CHECK(attempts>0), PRIMARY KEY(kind,bucket,window_at)
);
CREATE TABLE schoolvault.admin_logins (
 token_hash text PRIMARY KEY, email text NOT NULL, browser_hash text NOT NULL,
 expires_at timestamptz NOT NULL, consumed_at timestamptz
);
CREATE TABLE schoolvault.admin_sessions (
 token_hash text PRIMARY KEY, email text NOT NULL, expires_at timestamptz NOT NULL,
 revoked_at timestamptz
);
CREATE TABLE schoolvault.admission_audit (
 id uuid PRIMARY KEY, admin_email text NOT NULL, request_id uuid NOT NULL REFERENCES schoolvault.access_requests(id),
 action text NOT NULL CHECK(action IN('approved','declined')), created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT,INSERT,UPDATE,DELETE ON schoolvault.access_requests,schoolvault.access_limits,schoolvault.admin_logins,schoolvault.admin_sessions TO schoolvault_web;
GRANT SELECT,INSERT ON schoolvault.admission_audit TO schoolvault_web;
COMMIT;
