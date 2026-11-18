BEGIN;
CREATE SCHEMA IF NOT EXISTS schoolvault;
CREATE TABLE schoolvault.users (
 id uuid PRIMARY KEY, google_sub text UNIQUE NOT NULL, email text NOT NULL,
 name text NOT NULL DEFAULT '', timezone text NOT NULL DEFAULT 'America/Halifax',
 created_at timestamptz NOT NULL DEFAULT now(), disabled_at timestamptz
);
CREATE TABLE schoolvault.sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES schoolvault.users(id),
 expires_at timestamptz NOT NULL, revoked_at timestamptz
);
CREATE INDEX ON schoolvault.sessions(user_id);
CREATE TABLE schoolvault.login_attempts (
 state_hash text PRIMARY KEY, browser_hash text NOT NULL, nonce text NOT NULL,
 verifier text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE schoolvault.vaults (
 user_id uuid PRIMARY KEY REFERENCES schoolvault.users(id), created_at timestamptz NOT NULL DEFAULT now(),
 quota_bytes bigint NOT NULL DEFAULT 2147483648 CHECK(quota_bytes>0)
);
CREATE TABLE schoolvault.courses (
 user_id uuid NOT NULL REFERENCES schoolvault.users(id), id uuid NOT NULL,
 code text NOT NULL, title text NOT NULL, moodle_id text, url text,
 kind text NOT NULL DEFAULT 'lecture' CHECK(kind IN ('lecture','lab','support')),
 PRIMARY KEY(user_id,id), UNIQUE(user_id,moodle_id)
);
CREATE TABLE schoolvault.sources (
 user_id uuid NOT NULL, id uuid NOT NULL, course_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('note','file','moodle','ai_draft')),
 title text NOT NULL, original_url text, current_version uuid,
 PRIMARY KEY(user_id,id), UNIQUE(user_id,id,course_id), FOREIGN KEY(user_id,course_id) REFERENCES schoolvault.courses(user_id,id)
);
CREATE TABLE schoolvault.source_versions (
 user_id uuid NOT NULL, id uuid NOT NULL, source_id uuid NOT NULL,
 body text NOT NULL DEFAULT '', sha256 text NOT NULL CHECK(length(sha256)=64),
 observed_at timestamptz NOT NULL DEFAULT now(), object_key text, mime text, bytes bigint NOT NULL DEFAULT 0 CHECK(bytes>=0),
 PRIMARY KEY(user_id,id), UNIQUE(user_id,source_id,id),
 FOREIGN KEY(user_id,source_id) REFERENCES schoolvault.sources(user_id,id)
);
ALTER TABLE schoolvault.sources ADD FOREIGN KEY(user_id,id,current_version)
 REFERENCES schoolvault.source_versions(user_id,source_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE schoolvault.passages (
 user_id uuid NOT NULL, id uuid NOT NULL, source_id uuid NOT NULL, version_id uuid NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal>=0), body text NOT NULL,
 PRIMARY KEY(user_id,id), UNIQUE(user_id,version_id,ordinal),
 FOREIGN KEY(user_id,source_id,version_id) REFERENCES schoolvault.source_versions(user_id,source_id,id)
);
CREATE INDEX passage_search ON schoolvault.passages USING gin(to_tsvector('english',body));
CREATE TABLE schoolvault.edges (
 user_id uuid NOT NULL, id uuid NOT NULL, from_source uuid NOT NULL, to_source uuid NOT NULL,
 relation text NOT NULL, strength numeric NOT NULL CHECK(strength>=0 AND strength<=1),
 PRIMARY KEY(user_id,id),
 FOREIGN KEY(user_id,from_source) REFERENCES schoolvault.sources(user_id,id),
 FOREIGN KEY(user_id,to_source) REFERENCES schoolvault.sources(user_id,id)
);
CREATE TABLE schoolvault.notes (
 user_id uuid NOT NULL, id uuid NOT NULL, course_id uuid NOT NULL, source_id uuid NOT NULL,
 title text NOT NULL, body text NOT NULL DEFAULT '', transcript text NOT NULL DEFAULT '',
 summary text NOT NULL DEFAULT '', origin text NOT NULL DEFAULT 'app', version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,id), UNIQUE(user_id,source_id),
 FOREIGN KEY(user_id,course_id) REFERENCES schoolvault.courses(user_id,id),
 FOREIGN KEY(user_id,source_id,course_id) REFERENCES schoolvault.sources(user_id,id,course_id)
);
CREATE TABLE schoolvault.note_revisions (
 user_id uuid NOT NULL, id uuid NOT NULL, note_id uuid NOT NULL, version integer NOT NULL,
 snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,id), FOREIGN KEY(user_id,note_id) REFERENCES schoolvault.notes(user_id,id)
);
CREATE TABLE schoolvault.tasks (
 user_id uuid NOT NULL, id uuid NOT NULL, course_id uuid NOT NULL, source_id uuid NOT NULL,
 external_id text NOT NULL, evidence jsonb NOT NULL, observed_at timestamptz NOT NULL,
 PRIMARY KEY(user_id,id), UNIQUE(user_id,course_id,external_id),
 FOREIGN KEY(user_id,course_id) REFERENCES schoolvault.courses(user_id,id),
 FOREIGN KEY(user_id,source_id,course_id) REFERENCES schoolvault.sources(user_id,id,course_id)
);
CREATE TABLE schoolvault.meetings (
 user_id uuid NOT NULL, id uuid NOT NULL, course_id uuid NOT NULL, source_id uuid NOT NULL,
 schedule jsonb NOT NULL, PRIMARY KEY(user_id,id),
 FOREIGN KEY(user_id,course_id) REFERENCES schoolvault.courses(user_id,id),
 FOREIGN KEY(user_id,source_id,course_id) REFERENCES schoolvault.sources(user_id,id,course_id)
);
CREATE TABLE schoolvault.chats (
 user_id uuid NOT NULL, id uuid NOT NULL, title text NOT NULL DEFAULT 'New chat',
 course_id uuid, mode text NOT NULL DEFAULT 'ask' CHECK(mode IN ('ask','plan','study','solve','sources')),
 context jsonb NOT NULL DEFAULT '[]', draft text NOT NULL DEFAULT '', archived boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,id), FOREIGN KEY(user_id,course_id) REFERENCES schoolvault.courses(user_id,id)
);
CREATE TABLE schoolvault.messages (
 user_id uuid NOT NULL, id uuid NOT NULL, chat_id uuid NOT NULL,
 role text NOT NULL CHECK(role IN ('user','assistant')), content jsonb NOT NULL, sources jsonb NOT NULL DEFAULT '[]',
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,id),
 FOREIGN KEY(user_id,chat_id) REFERENCES schoolvault.chats(user_id,id)
);
CREATE TABLE schoolvault.jobs (
 user_id uuid NOT NULL, id uuid NOT NULL, chat_id uuid, note_id uuid,
 kind text NOT NULL CHECK(kind IN ('answer','summary','transcribe','extract','collect')),
 request_id uuid NOT NULL, input jsonb NOT NULL, result jsonb, error text,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','leased','complete','failed','cancelled')),
 lease_hash text, lease_until timestamptz, attempts integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,id), UNIQUE(user_id,request_id),
 FOREIGN KEY(user_id,chat_id) REFERENCES schoolvault.chats(user_id,id),
 FOREIGN KEY(user_id,note_id) REFERENCES schoolvault.notes(user_id,id)
);
CREATE UNIQUE INDEX one_active_chat_job ON schoolvault.jobs(user_id,chat_id)
 WHERE chat_id IS NOT NULL AND status IN ('queued','leased');
CREATE TABLE schoolvault.connectors (
 user_id uuid NOT NULL, id uuid NOT NULL, provider text NOT NULL,
 identity text, status text NOT NULL, credential_box text,
 checked_at timestamptz, revoked_at timestamptz,
 PRIMARY KEY(user_id,id), UNIQUE(user_id,provider), FOREIGN KEY(user_id) REFERENCES schoolvault.users(id)
);
CREATE TABLE schoolvault.audit (
 user_id uuid NOT NULL REFERENCES schoolvault.users(id), id uuid NOT NULL,
 action text NOT NULL, target uuid, details jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['vaults','courses','sources','source_versions','passages','edges','notes','note_revisions','tasks','meetings','chats','messages','jobs','connectors','audit'] LOOP
  EXECUTE format('ALTER TABLE schoolvault.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE schoolvault.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY own_rows ON schoolvault.%I USING (user_id = nullif(current_setting(''schoolvault.user_id'',true),'''')::uuid) WITH CHECK (user_id = nullif(current_setting(''schoolvault.user_id'',true),'''')::uuid)',t);
 END LOOP;
END $$;
-- The migration role owns the schema; the runtime role has no DDL or BYPASSRLS.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='schoolvault_web') THEN
  CREATE ROLE schoolvault_web NOLOGIN NOSUPERUSER NOBYPASSRLS;
 END IF;
END $$;
GRANT USAGE ON SCHEMA schoolvault TO schoolvault_web;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA schoolvault TO schoolvault_web;
COMMIT;
