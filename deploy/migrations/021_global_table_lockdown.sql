BEGIN;
-- Global (cross-tenant) tables were readable and writable in full by the runtime role.
-- A single SQL injection or logic bug could list every email, session and token hash,
-- or rewrite admissions and admin state. The runtime role now keeps only the columns
-- and operations it needs; cross-tenant lookups go through narrow SECURITY DEFINER
-- functions that take a hash or id and return at most the one matching row.

-- worker_status, storage_budget, access_limits and demo_attempts keep their earlier narrow
-- grants: they are singleton counters or hashed rate-limit buckets with no identity data.

-- Owner of the definer functions. It cannot log in; only the migration role can use it.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='schoolvault_definer') THEN
  CREATE ROLE schoolvault_definer NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION;
 END IF;
 -- PostgreSQL 16 requires SET membership to transfer ownership. Superusers already have it.
 IF current_setting('server_version_num')::int>=160000 THEN
  IF NOT pg_has_role(current_user,'schoolvault_definer','SET') THEN
   EXECUTE format('GRANT schoolvault_definer TO %I WITH INHERIT FALSE, SET TRUE',current_user);
  END IF;
 ELSIF NOT pg_has_role(current_user,'schoolvault_definer','MEMBER') THEN
  EXECUTE format('GRANT schoolvault_definer TO %I',current_user);
 END IF;
END $$;
-- CREATE is needed only while ownership moves; it is revoked again below.
GRANT USAGE,CREATE ON SCHEMA schoolvault TO schoolvault_definer;

-- Runtime privileges: revoke everything on the global identity/admission tables, then
-- grant back exact columns. No runtime grant exposes email, name, google_sub, any token
-- or code hash, an OAuth nonce/verifier, access requests, admin rows or the admission audit.
REVOKE ALL ON schoolvault.users,schoolvault.sessions,schoolvault.login_attempts,
 schoolvault.companion_pairings,schoolvault.companion_tokens,schoolvault.access_requests,
 schoolvault.admin_logins,schoolvault.admin_sessions,schoolvault.admission_audit FROM schoolvault_web;

-- users: worker fairness, account state and demo lifecycle need only non-identifying columns.
GRANT SELECT(id,timezone,demo,disabled_at,created_at,last_answer_lease_at,last_extract_lease_at,
 last_profile_lease_at,last_transcribe_lease_at,last_cornell_lease_at,last_class_action_at) ON schoolvault.users TO schoolvault_web;
-- Inserting cannot read anything back; google_sub/email are never updatable by the web role.
GRANT INSERT(id,google_sub,email,name,timezone,demo,created_at,disabled_at) ON schoolvault.users TO schoolvault_web;
GRANT UPDATE(disabled_at,created_at,last_answer_lease_at,last_extract_lease_at,last_profile_lease_at,
 last_transcribe_lease_at,last_cornell_lease_at,last_class_action_at) ON schoolvault.users TO schoolvault_web;

-- sessions, companion tokens and pairings: tenant-owned rows under forced RLS; hashes unreadable.
GRANT SELECT(user_id,expires_at,revoked_at,demo),INSERT,DELETE ON schoolvault.sessions TO schoolvault_web;
GRANT SELECT(user_id,device_id,expires_at),INSERT,DELETE ON schoolvault.companion_tokens TO schoolvault_web;
GRANT SELECT(user_id,label,expires_at),UPDATE(expires_at),INSERT,DELETE ON schoolvault.companion_pairings TO schoolvault_web;
-- login_attempts: legacy OAuth state rows. state/browser hashes are not secrets; nonce/verifier are.
GRANT SELECT(state_hash,browser_hash,expires_at),INSERT,DELETE ON schoolvault.login_attempts TO schoolvault_web;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['sessions','companion_tokens','companion_pairings'] LOOP
  EXECUTE format('ALTER TABLE schoolvault.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE schoolvault.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format($policy$CREATE POLICY own_rows ON schoolvault.%I USING (user_id = nullif(current_setting('schoolvault.user_id',true),'')::uuid) WITH CHECK (user_id = nullif(current_setting('schoolvault.user_id',true),'')::uuid)$policy$,t);
  -- Only the definer functions below (owned by this NOLOGIN role) see across tenants.
  EXECUTE format('CREATE POLICY definer_lookup ON schoolvault.%I TO schoolvault_definer USING (true) WITH CHECK (true)',t);
 END LOOP;
END $$;

GRANT SELECT,INSERT,UPDATE ON schoolvault.users TO schoolvault_definer;
GRANT SELECT,UPDATE ON schoolvault.sessions TO schoolvault_definer;
GRANT SELECT ON schoolvault.companion_tokens TO schoolvault_definer;
GRANT SELECT,DELETE ON schoolvault.companion_pairings,schoolvault.login_attempts TO schoolvault_definer;
GRANT SELECT,INSERT,UPDATE ON schoolvault.access_requests TO schoolvault_definer;
GRANT INSERT ON schoolvault.admission_audit TO schoolvault_definer;
GRANT SELECT,INSERT,UPDATE,DELETE ON schoolvault.admin_logins,schoolvault.admin_sessions TO schoolvault_definer;

-- Student sessions -----------------------------------------------------------------------
CREATE FUNCTION schoolvault.session_actor(p_token_hash text)
RETURNS TABLE(id uuid,name text,email text,timezone text,demo boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
 SELECT u.id,u.name,u.email,u.timezone,u.demo FROM schoolvault.sessions s JOIN schoolvault.users u ON u.id=s.user_id
 WHERE p_token_hash ~ '^[0-9a-f]{64}$' AND s.token_hash=p_token_hash AND s.expires_at>now()
  AND s.revoked_at IS NULL AND u.disabled_at IS NULL AND s.demo=u.demo
$$;
CREATE FUNCTION schoolvault.revoke_session(p_token_hash text) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
 UPDATE schoolvault.sessions SET revoked_at=now() WHERE p_token_hash ~ '^[0-9a-f]{64}$' AND token_hash=p_token_hash
$$;
-- Demo reset retires the single active demo tenant's sessions; real accounts are untouched.
CREATE FUNCTION schoolvault.revoke_active_demo_sessions() RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
 UPDATE schoolvault.sessions SET revoked_at=now() WHERE revoked_at IS NULL
  AND user_id IN (SELECT u.id FROM schoolvault.users u WHERE u.demo AND u.disabled_at IS NULL)
$$;
-- Google sign-in: identity checks and the upsert read email/google_sub on the runtime's behalf.
CREATE FUNCTION schoolvault.google_email_conflict(p_email text,p_sub text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
 SELECT EXISTS(SELECT 1 FROM schoolvault.users u WHERE lower(u.email)=p_email AND u.google_sub<>p_sub)
$$;
CREATE FUNCTION schoolvault.upsert_google_user(p_id uuid,p_sub text,p_email text,p_name text)
RETURNS TABLE(account_id uuid,account_disabled_at timestamptz,account_demo boolean)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
 INSERT INTO schoolvault.users AS u(id,google_sub,email,name) VALUES(p_id,p_sub,p_email,p_name)
 ON CONFLICT(google_sub) DO UPDATE SET email=EXCLUDED.email,name=EXCLUDED.name
 RETURNING u.id,u.disabled_at,u.demo
$$;
-- Legacy (pre-sealed-cookie) OAuth attempts: single-use, keyed by both hashes.
CREATE FUNCTION schoolvault.consume_login_attempt(p_state_hash text,p_browser_hash text)
RETURNS TABLE(nonce text,verifier text)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
 DELETE FROM schoolvault.login_attempts a WHERE a.state_hash=p_state_hash AND a.browser_hash=p_browser_hash AND a.expires_at>now()
 RETURNING a.nonce,a.verifier
$$;
-- Local single-owner profile check without exposing google_sub.
CREATE FUNCTION schoolvault.local_owner_ready(p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
 SELECT EXISTS(SELECT 1 FROM schoolvault.users u WHERE u.id=p_user AND u.google_sub='local:'||p_user::text AND NOT u.demo AND u.disabled_at IS NULL)
$$;

-- Companion laptops ----------------------------------------------------------------------
CREATE FUNCTION schoolvault.companion_actor(p_token_hash text)
RETURNS TABLE(user_id uuid,device_id uuid,demo boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
 SELECT t.user_id,t.device_id,u.demo FROM schoolvault.companion_tokens t JOIN schoolvault.users u ON u.id=t.user_id
 WHERE p_token_hash ~ '^[0-9a-f]{64}$' AND t.token_hash=p_token_hash AND t.expires_at>now() AND u.disabled_at IS NULL
$$;
CREATE FUNCTION schoolvault.companion_pairing_owner(p_code_hash text)
RETURNS TABLE(user_id uuid,email text,demo boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
 SELECT p.user_id,u.email,u.demo FROM schoolvault.companion_pairings p JOIN schoolvault.users u ON u.id=p.user_id
 WHERE p_code_hash ~ '^[0-9a-f]{64}$' AND p.code_hash=p_code_hash AND p.expires_at>now() AND u.disabled_at IS NULL
$$;
CREATE FUNCTION schoolvault.consume_companion_pairing(p_code_hash text,p_user uuid) RETURNS text
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
 DELETE FROM schoolvault.companion_pairings p WHERE p_code_hash ~ '^[0-9a-f]{64}$' AND p.code_hash=p_code_hash AND p.user_id=p_user AND p.expires_at>now()
 RETURNING p.label
$$;
-- Expired codes from any account are useless; removing them reveals nothing.
CREATE FUNCTION schoolvault.purge_expired_companion_pairings() RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
 DELETE FROM schoolvault.companion_pairings WHERE expires_at<now()
$$;

-- Admissions -----------------------------------------------------------------------------
CREATE FUNCTION schoolvault.request_access(p_id uuid,p_email text,p_name text) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
 INSERT INTO schoolvault.access_requests(id,email,name,acadia_student) VALUES(p_id,p_email,p_name,true) ON CONFLICT(email) DO NOTHING
$$;
CREATE FUNCTION schoolvault.access_request_approved(p_email text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
 SELECT EXISTS(SELECT 1 FROM schoolvault.access_requests r WHERE r.email=p_email AND r.status='approved')
$$;
CREATE FUNCTION schoolvault.admin_session_email(p_token_hash text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
 SELECT s.email FROM schoolvault.admin_sessions s
 WHERE p_token_hash ~ '^[0-9a-f]{64}$' AND s.token_hash=p_token_hash AND s.expires_at>now() AND s.revoked_at IS NULL
$$;
CREATE FUNCTION schoolvault.revoke_admin_session(p_token_hash text) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
 UPDATE schoolvault.admin_sessions SET revoked_at=now() WHERE p_token_hash ~ '^[0-9a-f]{64}$' AND token_hash=p_token_hash
$$;
-- The application checks the admin allowlist before calling this.
CREATE FUNCTION schoolvault.create_admin_login(p_token_hash text,p_email text,p_browser_hash text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
BEGIN
 IF p_token_hash !~ '^[0-9a-f]{64}$' OR p_browser_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Invalid admin login'; END IF;
 DELETE FROM schoolvault.admin_logins l WHERE l.expires_at<now() OR l.email=p_email;
 INSERT INTO schoolvault.admin_logins(token_hash,email,browser_hash,expires_at) VALUES(p_token_hash,p_email,p_browser_hash,now()+interval '10 minutes');
END $$;
-- Consumes a browser-bound login link and issues an admin session for that link's email.
-- Returns NULL when the link is unknown, expired, used or bound to another browser.
CREATE FUNCTION schoolvault.consume_admin_login(p_token_hash text,p_browser_hash text,p_session_hash text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
DECLARE v_email text;
BEGIN
 IF p_session_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Invalid admin session'; END IF;
 SELECT l.email INTO v_email FROM schoolvault.admin_logins l
  WHERE l.token_hash=p_token_hash AND l.browser_hash=p_browser_hash AND l.expires_at>now() AND l.consumed_at IS NULL FOR UPDATE;
 IF v_email IS NULL THEN RETURN NULL; END IF;
 UPDATE schoolvault.admin_logins SET consumed_at=now() WHERE token_hash=p_token_hash;
 DELETE FROM schoolvault.admin_sessions s WHERE s.expires_at<now() OR s.email=v_email;
 INSERT INTO schoolvault.admin_sessions(token_hash,email,expires_at) VALUES(p_session_hash,v_email,now()+interval '8 hours');
 RETURN v_email;
END $$;
-- Admin reads and decisions require a live admin session; the audit's admin email comes
-- from that session row, never from the caller.
CREATE FUNCTION schoolvault.admin_access_requests(p_admin_hash text)
RETURNS TABLE(id uuid,email text,name text,acadia_student boolean,status text,created_at timestamptz,decided_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
 SELECT r.id,r.email,r.name,r.acadia_student,r.status,r.created_at,r.decided_at FROM schoolvault.access_requests r
 WHERE schoolvault.admin_session_email(p_admin_hash) IS NOT NULL ORDER BY r.created_at DESC LIMIT 200
$$;
CREATE FUNCTION schoolvault.admin_lock_access_request(p_admin_hash text,p_id uuid)
RETURNS TABLE(email text,status text)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
 SELECT r.email,r.status FROM schoolvault.access_requests r
 WHERE schoolvault.admin_session_email(p_admin_hash) IS NOT NULL AND r.id=p_id FOR UPDATE
$$;
CREATE FUNCTION schoolvault.admin_decide_access_request(p_admin_hash text,p_id uuid,p_decision text,p_audit_id uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
DECLARE v_admin text;
BEGIN
 v_admin:=schoolvault.admin_session_email(p_admin_hash);
 IF v_admin IS NULL OR p_decision NOT IN('approved','declined') THEN RETURN false; END IF;
 UPDATE schoolvault.access_requests SET status=p_decision,decided_at=now(),decided_by=v_admin WHERE id=p_id AND status='pending';
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO schoolvault.admission_audit(id,admin_email,request_id,action) VALUES(p_audit_id,v_admin,p_id,p_decision);
 RETURN true;
END $$;

DO $$ DECLARE f regprocedure; BEGIN
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='schoolvault' AND p.proname IN('session_actor','revoke_session','revoke_active_demo_sessions',
   'google_email_conflict','upsert_google_user','consume_login_attempt','local_owner_ready','companion_actor',
   'companion_pairing_owner','consume_companion_pairing','purge_expired_companion_pairings','request_access',
   'access_request_approved','admin_session_email','revoke_admin_session','create_admin_login','consume_admin_login',
   'admin_access_requests','admin_lock_access_request','admin_decide_access_request') LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO schoolvault_definer',f);
 END LOOP;
END $$;
-- Ownership transfer does not inherit owner privileges on PostgreSQL 16+.
-- Apply ACLs as the exact NOLOGIN owner; otherwise GRANT/REVOKE can only warn
-- and leave the default PUBLIC execution privilege in place.
SET LOCAL ROLE schoolvault_definer;
DO $$ DECLARE f regprocedure; BEGIN
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='schoolvault' AND p.prosecdef AND p.proowner='schoolvault_definer'::regrole LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO schoolvault_web',f);
 END LOOP;
END $$;
SET LOCAL ROLE NONE;
REVOKE CREATE ON SCHEMA schoolvault FROM schoolvault_definer;
COMMIT;
