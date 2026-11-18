BEGIN;
-- Workstream C: per-learner connector accounts for the new connector layer
-- (Moodle token, Canvas, Brightspace, Outlook, Gmail). The desktop Companion
-- keeps its existing schoolvault.connectors row as the "session bridge".
-- Tokens are stored only as AES-256-GCM boxes sealed by the web process with a
-- key held outside the database; revocation wipes the box. Passwords are never stored.
CREATE TABLE schoolvault.connector_accounts (
 user_id uuid NOT NULL REFERENCES schoolvault.users(id), id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('moodle_token','canvas','brightspace','outlook','gmail')),
 mode text NOT NULL CHECK(mode IN ('token','oauth')),
 institution_id text CHECK(institution_id IS NULL OR institution_id ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
 site_url text CHECK(site_url IS NULL OR (site_url ~ '^https://' AND length(site_url)<=500)),
 display_name text NOT NULL DEFAULT '' CHECK(length(display_name)<=200),
 external_identity text CHECK(external_identity IS NULL OR length(external_identity)<=200),
 status text NOT NULL DEFAULT 'connected' CHECK(status IN ('connected','needs_reauth','error','revoked')),
 token_box text CHECK(token_box IS NULL OR length(token_box)<=20000),
 token_key_version integer NOT NULL DEFAULT 1,
 token_expires_at timestamptz,
 scopes text NOT NULL DEFAULT '' CHECK(length(scopes)<=4000),
 sync_cursor jsonb NOT NULL DEFAULT '{}',
 last_sync_at timestamptz, last_error text CHECK(last_error IS NULL OR length(last_error)<=500),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
 PRIMARY KEY(user_id,id),
 CHECK((revoked_at IS NULL)=(status<>'revoked')),
 CHECK(revoked_at IS NULL OR token_box IS NULL)
);
CREATE UNIQUE INDEX connector_account_active ON schoolvault.connector_accounts(user_id,kind,coalesce(site_url,institution_id,'')) WHERE revoked_at IS NULL;

-- Short-lived OAuth / Moodle SSO handshakes. Only hashes of the state are kept;
-- the PKCE verifier or SSO passport is sealed like a token.
CREATE TABLE schoolvault.connector_handshakes (
 user_id uuid NOT NULL REFERENCES schoolvault.users(id), state_hash text NOT NULL CHECK(length(state_hash)=64),
 kind text NOT NULL CHECK(kind IN ('moodle_token','canvas','brightspace','outlook','gmail')),
 institution_id text, site_url text, secret_box text NOT NULL,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,state_hash)
);

-- What each account has written, keyed by the provider's stable reference, so a
-- re-sync adds a new source version only when the content hash changed.
CREATE TABLE schoolvault.connector_items (
 user_id uuid NOT NULL, account_id uuid NOT NULL, external_ref text NOT NULL CHECK(length(external_ref)<=500),
 item_kind text NOT NULL CHECK(item_kind IN ('course','document','file','assignment','event','group','mail','attachment')),
 course_id uuid, source_id uuid, content_hash text,
 metadata jsonb NOT NULL DEFAULT '{}', first_seen_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,account_id,external_ref),
 FOREIGN KEY(user_id,account_id) REFERENCES schoolvault.connector_accounts(user_id,id),
 FOREIGN KEY(user_id,course_id) REFERENCES schoolvault.courses(user_id,id),
 FOREIGN KEY(user_id,source_id) REFERENCES schoolvault.sources(user_id,id)
);
CREATE INDEX ON schoolvault.connector_items(user_id,source_id);

CREATE TABLE schoolvault.connector_sync_runs (
 user_id uuid NOT NULL, id uuid NOT NULL, account_id uuid NOT NULL,
 started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','complete','partial','failed')),
 counts jsonb NOT NULL DEFAULT '{}', issues jsonb NOT NULL DEFAULT '[]', error text CHECK(error IS NULL OR length(error)<=500),
 PRIMARY KEY(user_id,id), FOREIGN KEY(user_id,account_id) REFERENCES schoolvault.connector_accounts(user_id,id)
);
CREATE UNIQUE INDEX one_running_sync ON schoolvault.connector_sync_runs(user_id,account_id) WHERE status='running';

-- Mail: the learner confirms which senders belong to which course. Nothing else is kept.
CREATE TABLE schoolvault.connector_mail_senders (
 user_id uuid NOT NULL, account_id uuid NOT NULL, address text NOT NULL CHECK(address=lower(address) AND length(address)<=254 AND address ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
 course_id uuid NOT NULL, confirmed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,account_id,address),
 FOREIGN KEY(user_id,account_id) REFERENCES schoolvault.connector_accounts(user_id,id),
 FOREIGN KEY(user_id,course_id) REFERENCES schoolvault.courses(user_id,id)
);

-- New source kinds: 'lms' (Canvas/Brightspace pages and instructions) and 'email'
-- (confirmed course mail). Moodle token items keep kind 'moodle'; files stay 'file'.
ALTER TABLE schoolvault.sources DROP CONSTRAINT sources_kind_check;
ALTER TABLE schoolvault.sources ADD CONSTRAINT sources_kind_check CHECK(kind IN ('note','file','moodle','ai_draft','lms','email'));
CREATE UNIQUE INDEX connector_source_identity ON schoolvault.sources(user_id,course_id,original_url) WHERE kind IN ('lms','email');

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['connector_accounts','connector_handshakes','connector_items','connector_sync_runs','connector_mail_senders'] LOOP
  EXECUTE format('ALTER TABLE schoolvault.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE schoolvault.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY own_rows ON schoolvault.%I USING (user_id = nullif(current_setting(''schoolvault.user_id'',true),'''')::uuid) WITH CHECK (user_id = nullif(current_setting(''schoolvault.user_id'',true),'''')::uuid)',t);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON schoolvault.connector_accounts,schoolvault.connector_items,schoolvault.connector_sync_runs TO schoolvault_web;
GRANT SELECT,INSERT,DELETE ON schoolvault.connector_handshakes TO schoolvault_web;
GRANT SELECT,INSERT,UPDATE,DELETE ON schoolvault.connector_mail_senders TO schoolvault_web;
COMMIT;
