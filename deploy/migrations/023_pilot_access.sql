BEGIN;
ALTER TABLE schoolvault.access_requests
 ADD COLUMN origin text NOT NULL DEFAULT 'request' CHECK(origin IN('request','invitation','existing')),
 ADD COLUMN access_state text NOT NULL DEFAULT 'active' CHECK(access_state IN('active','suspended'));
ALTER TABLE schoolvault.admission_audit DROP CONSTRAINT admission_audit_action_check;
ALTER TABLE schoolvault.admission_audit ADD CONSTRAINT admission_audit_action_check
 CHECK(action IN('approved','declined','invited','suspended','restored','approval-email-sent','approval-email-failed','approval-email-unknown'));
GRANT CREATE ON SCHEMA schoolvault TO schoolvault_definer;
GRANT SELECT,UPDATE ON schoolvault.companion_devices,schoolvault.connectors,schoolvault.jobs TO schoolvault_definer;
GRANT DELETE ON schoolvault.companion_tokens,schoolvault.companion_pairings TO schoolvault_definer;

-- Carry forward already-active real accounts without touching pending/declined requests,
-- disabled identity tombstones or reviewer demo accounts. No mail is sent by migration.
INSERT INTO schoolvault.access_requests(id,email,name,acadia_student,status,origin,decided_at)
 SELECT gen_random_uuid(),lower(u.email),coalesce(nullif(u.name,''),'Existing pilot student'),true,'approved','existing',now()
 FROM schoolvault.users u WHERE NOT u.demo AND u.disabled_at IS NULL
 ON CONFLICT(email) DO NOTHING;

-- A suspension takes precedence over the old configured invitation allowlist.
CREATE FUNCTION schoolvault.access_request_state(p_email text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
 SELECT CASE WHEN r.access_state='suspended' THEN 'suspended' ELSE r.status END
 FROM schoolvault.access_requests r WHERE r.email=p_email
$$;
CREATE FUNCTION schoolvault.admin_invite_student(p_admin_hash text,p_id uuid,p_email text,p_name text,p_audit_id uuid)
RETURNS TABLE(id uuid,outcome text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
DECLARE v_admin text; r record;
BEGIN
 v_admin:=schoolvault.admin_session_email(p_admin_hash);
 IF v_admin IS NULL THEN RETURN QUERY SELECT NULL::uuid,'unauthorized'::text;RETURN;END IF;
 IF p_email IS NULL OR p_email<>lower(p_email) OR length(p_email)>254 OR p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  OR p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 100 OR p_name ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Invalid student identity';END IF;
 IF p_email=v_admin THEN RETURN QUERY SELECT NULL::uuid,'admin'::text;RETURN;END IF;
 PERFORM pg_advisory_xact_lock(hashtext('schoolvault-email:'||p_email));
 SELECT a.id,a.status,a.access_state INTO r FROM schoolvault.access_requests a WHERE a.email=p_email FOR UPDATE;
 IF FOUND THEN
  RETURN QUERY SELECT r.id,CASE WHEN r.access_state='suspended' THEN 'suspended' WHEN r.status='approved' THEN 'existing' ELSE 'decision-required' END;RETURN;
 END IF;
 IF EXISTS(SELECT 1 FROM schoolvault.users u WHERE lower(u.email)=p_email AND u.disabled_at IS NOT NULL) THEN
  RETURN QUERY SELECT NULL::uuid,'disabled'::text;RETURN;
 END IF;
 INSERT INTO schoolvault.access_requests(id,email,name,acadia_student,status,decided_at,decided_by,origin)
 VALUES(p_id,p_email,trim(p_name),true,'approved',now(),v_admin,'invitation');
 INSERT INTO schoolvault.admission_audit(id,admin_email,request_id,action) VALUES(p_audit_id,v_admin,p_id,'invited');
 RETURN QUERY SELECT p_id,'invited'::text;
END $$;

-- Only setup metadata is returned: no course names, notes, sources or chat content.
CREATE FUNCTION schoolvault.admin_students(p_admin_hash text)
RETURNS TABLE(id uuid,email text,name text,origin text,access_state text,joined_at timestamptz,has_companion boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
DECLARE r record; joined timestamptz; connected boolean; account_id uuid;
BEGIN
 IF schoolvault.admin_session_email(p_admin_hash) IS NULL THEN RETURN;END IF;
 FOR r IN SELECT a.id,a.email,a.name,a.origin,a.access_state FROM schoolvault.access_requests a
  WHERE a.status='approved' ORDER BY a.created_at DESC LIMIT 200 LOOP
  SELECT u.id,u.created_at INTO account_id,joined FROM schoolvault.users u WHERE lower(u.email)=r.email AND NOT u.demo;
  connected:=false;
  IF account_id IS NOT NULL THEN
   PERFORM set_config('schoolvault.user_id',account_id::text,true);
   connected:=EXISTS(SELECT 1 FROM schoolvault.companion_devices d WHERE d.user_id=account_id AND d.revoked_at IS NULL);
  END IF;
  RETURN QUERY SELECT r.id,r.email,r.name,r.origin,r.access_state,joined,connected;
 END LOOP;
END $$;
CREATE FUNCTION schoolvault.admin_set_student_access(p_admin_hash text,p_id uuid,p_state text,p_audit_id uuid) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
DECLARE v_admin text;r record;u record;
BEGIN
 v_admin:=schoolvault.admin_session_email(p_admin_hash);
 IF v_admin IS NULL THEN RETURN 'unauthorized';END IF;
 IF p_state IS NULL OR p_state NOT IN('active','suspended') THEN RETURN 'invalid';END IF;
 SELECT a.email,a.status,a.access_state INTO r FROM schoolvault.access_requests a WHERE a.id=p_id;
 IF NOT FOUND OR r.status<>'approved' THEN RETURN 'not-found';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('schoolvault-email:'||r.email));
 SELECT a.email,a.status,a.access_state INTO r FROM schoolvault.access_requests a WHERE a.id=p_id FOR UPDATE;
 SELECT a.id,a.disabled_at INTO u FROM schoolvault.users a WHERE lower(a.email)=r.email AND NOT a.demo FOR UPDATE;
 IF r.access_state=p_state THEN RETURN 'unchanged';END IF;
 -- Never resurrect an independently disabled/deleted identity.
 IF p_state='suspended' AND u.disabled_at IS NOT NULL THEN RETURN 'disabled';END IF;
 UPDATE schoolvault.access_requests SET access_state=p_state WHERE id=p_id;
 IF u.id IS NOT NULL THEN
  UPDATE schoolvault.users SET disabled_at=CASE WHEN p_state='suspended' THEN now() ELSE NULL END WHERE users.id=u.id;
  IF p_state='suspended' THEN
   PERFORM set_config('schoolvault.user_id',u.id::text,true);
   UPDATE schoolvault.sessions SET revoked_at=now() WHERE user_id=u.id AND revoked_at IS NULL;
   DELETE FROM schoolvault.companion_tokens WHERE user_id=u.id;
   DELETE FROM schoolvault.companion_pairings WHERE user_id=u.id;
   UPDATE schoolvault.companion_devices SET revoked_at=now(),status='disconnected' WHERE user_id=u.id AND revoked_at IS NULL;
   UPDATE schoolvault.connectors SET revoked_at=now(),status='disconnected' WHERE user_id=u.id;
   UPDATE schoolvault.jobs SET status='cancelled',lease_hash=NULL,lease_until=NULL,error='Pilot access suspended by the administrator.',updated_at=now()
    WHERE user_id=u.id AND status IN('queued','leased');
  END IF;
 END IF;
 INSERT INTO schoolvault.admission_audit(id,admin_email,request_id,action)
 VALUES(p_audit_id,v_admin,p_id,CASE WHEN p_state='suspended' THEN 'suspended' ELSE 'restored' END);
 RETURN p_state;
END $$;

CREATE FUNCTION schoolvault.admin_access_requests_mail_v2(p_admin_hash text)
RETURNS TABLE(id uuid,email text,name text,acadia_student boolean,status text,created_at timestamptz,decided_at timestamptz,
 approval_mail text,approval_mail_transport text,approval_mail_sent_at timestamptz,origin text,access_state text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
 SELECT r.id,r.email,r.name,r.acadia_student,r.status,r.created_at,r.decided_at,
  CASE WHEN r.approval_mail_status='sending' AND r.approval_mail_attempted_at<now()-interval '2 minutes' THEN 'unknown' ELSE r.approval_mail_status END,
  r.approval_mail_transport,r.approval_mail_sent_at,r.origin,r.access_state
 FROM schoolvault.access_requests r
 WHERE schoolvault.admin_session_email(p_admin_hash) IS NOT NULL ORDER BY r.created_at DESC LIMIT 200
$$;

-- Reuse the atomic mail claim, exposing its invitation origin and forbidding suspended sends.
-- Migration 021 deliberately grants SET membership without inherited owner privileges.
-- Replace this existing definer-owned function as its owner, then return to the
-- maintenance role. CREATE OR REPLACE preserves its already-restricted ACL.
SET LOCAL ROLE schoolvault_definer;
CREATE OR REPLACE FUNCTION schoolvault.admin_claim_approval_mail(p_admin_hash text,p_id uuid,p_transport text,p_confirm_unknown boolean)
RETURNS TABLE(outcome text,email text,name text,origin text,attempt uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
DECLARE r record;v_state text;
BEGIN
 IF schoolvault.admin_session_email(p_admin_hash) IS NULL THEN RETURN QUERY SELECT 'unauthorized'::text,NULL::text,NULL::text,NULL::text,NULL::uuid;RETURN;END IF;
 IF p_transport IS NULL OR p_transport NOT IN('gmail','log') THEN RAISE EXCEPTION 'Invalid approval mail transport';END IF;
 SELECT a.* INTO r FROM schoolvault.access_requests a WHERE a.id=p_id FOR UPDATE;
 IF NOT FOUND THEN RETURN QUERY SELECT 'not-found'::text,NULL::text,NULL::text,NULL::text,NULL::uuid;RETURN;END IF;
 IF r.status<>'approved' OR r.access_state='suspended' THEN RETURN QUERY SELECT 'not-approved'::text,NULL::text,NULL::text,NULL::text,NULL::uuid;RETURN;END IF;
 v_state:=CASE WHEN r.approval_mail_status='sending' AND r.approval_mail_attempted_at<now()-interval '2 minutes' THEN 'unknown' ELSE r.approval_mail_status END;
 IF v_state IN('sent','sending') OR (v_state='unknown' AND p_confirm_unknown IS NOT TRUE) THEN
  RETURN QUERY SELECT v_state,NULL::text,NULL::text,NULL::text,NULL::uuid;RETURN;
 END IF;
 UPDATE schoolvault.access_requests SET approval_mail_status='sending',approval_mail_transport=p_transport,
  approval_mail_attempts=approval_mail_attempts+1,approval_mail_attempted_at=now(),approval_mail_attempt=gen_random_uuid() WHERE id=p_id;
 RETURN QUERY SELECT 'claimed'::text,r.email,r.name,r.origin,a.approval_mail_attempt FROM schoolvault.access_requests a WHERE a.id=p_id;
END $$;
SET LOCAL ROLE NONE;
DO $$ DECLARE f regprocedure; BEGIN
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='schoolvault' AND p.proname IN('admin_access_requests_mail_v2','access_request_state','admin_invite_student','admin_students','admin_set_student_access') LOOP
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
