BEGIN;
-- E4 assistant connections. Neyvu's web app is the OAuth 2.1 authorization server; the MCP
-- server (services/mcp) is a resource server. Learners authorize an assistant in the app;
-- no platform password or LMS token is ever entered into an assistant. Only SHA-256 hashes
-- of codes and tokens are stored. Tokens are bound to one resource (RFC 8707).

-- Dynamically registered public clients (RFC 7591, token_endpoint_auth_method=none).
CREATE TABLE schoolvault.oauth_clients (
 id text PRIMARY KEY CHECK(id ~ '^[A-Za-z0-9_-]{22,64}$'),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 redirect_uris text[] NOT NULL CHECK(cardinality(redirect_uris) BETWEEN 1 AND 10),
 created_at timestamptz NOT NULL DEFAULT now(), disabled_at timestamptz
);
-- A learner's standing authorization of one client for one resource. Learner-owned.
CREATE TABLE schoolvault.oauth_grants (
 user_id uuid NOT NULL REFERENCES schoolvault.users(id), id uuid NOT NULL,
 client_id text NOT NULL REFERENCES schoolvault.oauth_clients(id),
 resource text NOT NULL, scope text NOT NULL DEFAULT 'neyvu.read' CHECK(scope='neyvu.read'),
 created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz, revoked_at timestamptz,
 PRIMARY KEY(user_id,id)
);
CREATE TABLE schoolvault.oauth_codes (
 code_sha256 text PRIMARY KEY CHECK(length(code_sha256)=64),
 user_id uuid NOT NULL, grant_id uuid NOT NULL,
 client_id text NOT NULL, redirect_uri text NOT NULL,
 code_challenge text NOT NULL CHECK(code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
 resource text NOT NULL, expires_at timestamptz NOT NULL, used_at timestamptz,
 FOREIGN KEY(user_id,grant_id) REFERENCES schoolvault.oauth_grants(user_id,id)
);
CREATE TABLE schoolvault.oauth_tokens (
 token_sha256 text PRIMARY KEY CHECK(length(token_sha256)=64),
 kind text NOT NULL CHECK(kind IN ('access','refresh')),
 user_id uuid NOT NULL, grant_id uuid NOT NULL, client_id text NOT NULL, resource text NOT NULL,
 expires_at timestamptz NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(user_id,grant_id) REFERENCES schoolvault.oauth_grants(user_id,id)
);
CREATE INDEX ON schoolvault.oauth_tokens(user_id,grant_id);

ALTER TABLE schoolvault.oauth_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE schoolvault.oauth_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY own_rows ON schoolvault.oauth_grants TO schoolvault_web USING (user_id=schoolvault.actor_id()) WITH CHECK (user_id=schoolvault.actor_id());
CREATE POLICY definer_lookup ON schoolvault.oauth_grants TO schoolvault_definer USING (true) WITH CHECK (true);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['oauth_codes','oauth_tokens'] LOOP
  EXECUTE format('ALTER TABLE schoolvault.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE schoolvault.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY own_insert ON schoolvault.%I FOR INSERT TO schoolvault_web WITH CHECK (user_id=schoolvault.actor_id())',t);
  EXECUTE format('CREATE POLICY definer_lookup ON schoolvault.%I TO schoolvault_definer USING (true) WITH CHECK (true)',t);
 END LOOP;
END $$;
-- Learners may revoke their own tokens (UPDATE revoked_at) when they disconnect an assistant.
CREATE POLICY own_revoke ON schoolvault.oauth_tokens FOR UPDATE TO schoolvault_web USING (user_id=schoolvault.actor_id()) WITH CHECK (user_id=schoolvault.actor_id());
CREATE POLICY own_select ON schoolvault.oauth_tokens FOR SELECT TO schoolvault_web USING (user_id=schoolvault.actor_id());

GRANT SELECT,INSERT ON schoolvault.oauth_clients TO schoolvault_web;
GRANT SELECT,INSERT,UPDATE(revoked_at,last_used_at) ON schoolvault.oauth_grants TO schoolvault_web;
GRANT INSERT ON schoolvault.oauth_codes TO schoolvault_web;
GRANT SELECT(kind,user_id,grant_id,client_id,expires_at,revoked_at,created_at),UPDATE(revoked_at) ON schoolvault.oauth_tokens TO schoolvault_web;
GRANT SELECT,UPDATE ON schoolvault.oauth_codes TO schoolvault_definer;
GRANT SELECT,INSERT,UPDATE ON schoolvault.oauth_tokens TO schoolvault_definer;
GRANT SELECT,UPDATE(last_used_at) ON schoolvault.oauth_grants TO schoolvault_definer;
GRANT SELECT ON schoolvault.oauth_clients TO schoolvault_definer;

-- Token endpoint (no learner session): redeem a code with a PKCE S256 challenge computed by
-- the caller from the verifier, and store the new token hashes. Codes are single use; a
-- reused code revokes everything issued under its grant (OAuth 2.1 section 4.1.3) and
-- returns no row.
GRANT USAGE,CREATE ON SCHEMA schoolvault TO schoolvault_definer;
CREATE FUNCTION schoolvault.redeem_oauth_code(code_hash text,client text,redirect text,verifier_challenge text,access_hash text,refresh_hash text,access_seconds int)
 RETURNS TABLE(user_id uuid,resource text,scope text,access_expires_at timestamptz)
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
DECLARE c record; g record;
BEGIN
 SELECT * INTO c FROM schoolvault.oauth_codes WHERE code_sha256=code_hash FOR UPDATE;
 IF c IS NULL OR c.client_id<>client OR c.redirect_uri<>redirect OR c.expires_at<now() THEN RAISE EXCEPTION 'invalid_grant' USING ERRCODE='28000'; END IF;
 IF c.used_at IS NOT NULL THEN
  -- Revoke and return no row (a RAISE here would roll the revocation back); the caller
  -- answers invalid_grant for an empty result.
  UPDATE schoolvault.oauth_tokens t SET revoked_at=now() WHERE t.user_id=c.user_id AND t.grant_id=c.grant_id AND t.revoked_at IS NULL;
  RETURN;
 END IF;
 IF c.code_challenge<>verifier_challenge THEN RAISE EXCEPTION 'invalid_grant' USING ERRCODE='28000'; END IF;
 SELECT * INTO g FROM schoolvault.oauth_grants og WHERE og.user_id=c.user_id AND og.id=c.grant_id AND og.revoked_at IS NULL;
 IF g IS NULL THEN RAISE EXCEPTION 'invalid_grant' USING ERRCODE='28000'; END IF;
 UPDATE schoolvault.oauth_codes SET used_at=now() WHERE code_sha256=code_hash;
 INSERT INTO schoolvault.oauth_tokens VALUES(access_hash,'access',c.user_id,c.grant_id,client,c.resource,now()+make_interval(secs=>access_seconds),NULL,now());
 INSERT INTO schoolvault.oauth_tokens VALUES(refresh_hash,'refresh',c.user_id,c.grant_id,client,c.resource,now()+interval '30 days',NULL,now());
 RETURN QUERY SELECT c.user_id,c.resource,g.scope,now()+make_interval(secs=>access_seconds);
END $$;
-- Refresh tokens rotate; replaying a used refresh token revokes the grant's tokens.
CREATE FUNCTION schoolvault.refresh_oauth_token(refresh_old text,client text,access_hash text,refresh_hash text,access_seconds int)
 RETURNS TABLE(resource text,scope text,access_expires_at timestamptz)
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
DECLARE t record; g record;
BEGIN
 SELECT * INTO t FROM schoolvault.oauth_tokens WHERE token_sha256=refresh_old AND kind='refresh' FOR UPDATE;
 IF t IS NULL OR t.client_id<>client OR t.expires_at<now() THEN RAISE EXCEPTION 'invalid_grant' USING ERRCODE='28000'; END IF;
 IF t.revoked_at IS NOT NULL THEN
  UPDATE schoolvault.oauth_tokens x SET revoked_at=now() WHERE x.user_id=t.user_id AND x.grant_id=t.grant_id AND x.revoked_at IS NULL;
  RETURN;
 END IF;
 SELECT * INTO g FROM schoolvault.oauth_grants og WHERE og.user_id=t.user_id AND og.id=t.grant_id AND og.revoked_at IS NULL;
 IF g IS NULL THEN RAISE EXCEPTION 'invalid_grant' USING ERRCODE='28000'; END IF;
 UPDATE schoolvault.oauth_tokens SET revoked_at=now() WHERE token_sha256=refresh_old;
 INSERT INTO schoolvault.oauth_tokens VALUES(access_hash,'access',t.user_id,t.grant_id,client,t.resource,now()+make_interval(secs=>access_seconds),NULL,now());
 INSERT INTO schoolvault.oauth_tokens VALUES(refresh_hash,'refresh',t.user_id,t.grant_id,client,t.resource,now()+interval '30 days',NULL,now());
 RETURN QUERY SELECT t.resource,g.scope,now()+make_interval(secs=>access_seconds);
END $$;
-- Resource server lookup: an unexpired, unrevoked access token for an active grant and user.
CREATE FUNCTION schoolvault.oauth_access_actor(token_hash text)
 RETURNS TABLE(user_id uuid,client_id text,resource text,scope text,expires_at timestamptz)
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
BEGIN
 RETURN QUERY UPDATE schoolvault.oauth_grants g SET last_used_at=now()
  FROM schoolvault.oauth_tokens t, schoolvault.users u
  WHERE t.token_sha256=token_hash AND t.kind='access' AND t.revoked_at IS NULL AND t.expires_at>now()
   AND g.user_id=t.user_id AND g.id=t.grant_id AND g.revoked_at IS NULL AND u.id=t.user_id AND u.disabled_at IS NULL AND u.demo IS NOT TRUE
  RETURNING t.user_id,t.client_id,t.resource,g.scope,t.expires_at;
END $$;
ALTER FUNCTION schoolvault.redeem_oauth_code(text,text,text,text,text,text,int) OWNER TO schoolvault_definer;
ALTER FUNCTION schoolvault.refresh_oauth_token(text,text,text,text,int) OWNER TO schoolvault_definer;
ALTER FUNCTION schoolvault.oauth_access_actor(text) OWNER TO schoolvault_definer;
REVOKE ALL ON FUNCTION schoolvault.redeem_oauth_code(text,text,text,text,text,text,int),schoolvault.refresh_oauth_token(text,text,text,text,int),schoolvault.oauth_access_actor(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION schoolvault.redeem_oauth_code(text,text,text,text,text,text,int),schoolvault.refresh_oauth_token(text,text,text,text,int),schoolvault.oauth_access_actor(text) TO schoolvault_web;
REVOKE CREATE ON SCHEMA schoolvault FROM schoolvault_definer;
COMMIT;
