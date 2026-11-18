BEGIN;
-- Workstream C6: the public university corpus as institution-public data.
-- A separate schema with NO learner columns (no user_id, email, course or chat
-- reference anywhere), so private and public data cannot be joined by mistake.
-- The web runtime may only read it; the collector job writes through its own role.
CREATE SCHEMA IF NOT EXISTS institution_public;
CREATE TABLE institution_public.institutions (
 id text PRIMARY KEY CHECK(id ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
 name text NOT NULL, config jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE institution_public.sources (
 id text PRIMARY KEY, institution_id text NOT NULL REFERENCES institution_public.institutions(id),
 url text NOT NULL CHECK(url ~ '^https://'), title text NOT NULL, parent_url text,
 audience text NOT NULL DEFAULT 'unclassified', applicability text NOT NULL DEFAULT 'unknown',
 academic_year text, priority integer NOT NULL DEFAULT 50,
 discovered_at timestamptz NOT NULL, last_attempt timestamptz, last_success timestamptz,
 state text NOT NULL DEFAULT 'discovered', last_error text, current_version text,
 UNIQUE(institution_id,url)
);
CREATE TABLE institution_public.objects (
 sha256 text PRIMARY KEY CHECK(sha256 ~ '^[a-f0-9]{64}$'), mime text NOT NULL, bytes bigint NOT NULL CHECK(bytes>=0),
 body bytea NOT NULL, CHECK(octet_length(body)=bytes)
);
CREATE TABLE institution_public.versions (
 id text PRIMARY KEY, source_id text NOT NULL REFERENCES institution_public.sources(id),
 sha256 text NOT NULL REFERENCES institution_public.objects(sha256), kind text NOT NULL,
 captured_at timestamptz NOT NULL, transport text NOT NULL, final_url text NOT NULL,
 bytes bigint NOT NULL, units integer NOT NULL, flags jsonb NOT NULL DEFAULT '[]',
 review_state text NOT NULL DEFAULT 'unreviewed', UNIQUE(source_id,sha256)
);
ALTER TABLE institution_public.sources ADD FOREIGN KEY(current_version) REFERENCES institution_public.versions(id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE institution_public.passages (
 id bigserial PRIMARY KEY, version_id text NOT NULL REFERENCES institution_public.versions(id),
 page integer, start_offset integer NOT NULL, end_offset integer NOT NULL, text text NOT NULL,
 search tsvector GENERATED ALWAYS AS (to_tsvector('english',text)) STORED
);
CREATE INDEX institution_passage_search ON institution_public.passages USING gin(search);
CREATE INDEX ON institution_public.passages(version_id);
CREATE TABLE institution_public.attempts (
 id bigserial PRIMARY KEY, source_id text NOT NULL REFERENCES institution_public.sources(id),
 attempted_at timestamptz NOT NULL, outcome text NOT NULL, detail text
);
CREATE TABLE institution_public.links (
 source_id text NOT NULL REFERENCES institution_public.sources(id), url text NOT NULL,
 title text NOT NULL, collection_allowed boolean NOT NULL, PRIMARY KEY(source_id,url)
);
-- Which institution a learner belongs to is a learner setting, so it lives in the private schema.
ALTER TABLE schoolvault.users ADD COLUMN institution_id text CHECK(institution_id IS NULL OR institution_id ~ '^[a-z0-9][a-z0-9-]{0,62}$');

DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='institution_collector') THEN
  CREATE ROLE institution_collector NOLOGIN NOSUPERUSER NOBYPASSRLS;
 END IF;
END $$;
GRANT USAGE ON SCHEMA institution_public TO schoolvault_web,institution_collector;
GRANT SELECT ON ALL TABLES IN SCHEMA institution_public TO schoolvault_web;
GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA institution_public TO institution_collector;
GRANT DELETE ON institution_public.links TO institution_collector;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA institution_public TO institution_collector;
GRANT SELECT(institution_id) ON schoolvault.users TO schoolvault_web;
COMMIT;
