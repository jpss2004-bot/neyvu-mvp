BEGIN;
-- One approval email per admitted request. 'sending' is claimed before any network
-- step, so a repeated click, a second admin tab or a retry cannot send a second copy.
-- 'unknown' means the message reached Gmail but its acceptance was not confirmed.
ALTER TABLE schoolvault.access_requests
 ADD COLUMN approval_mail_status text NOT NULL DEFAULT 'none'
  CHECK(approval_mail_status IN('none','sending','sent','failed','unknown')),
 ADD COLUMN approval_mail_transport text CHECK(approval_mail_transport IN('gmail','log')),
 ADD COLUMN approval_mail_attempts integer NOT NULL DEFAULT 0 CHECK(approval_mail_attempts>=0),
 ADD COLUMN approval_mail_attempted_at timestamptz,
 ADD COLUMN approval_mail_sent_at timestamptz,
 ADD COLUMN approval_mail_attempt uuid,
 ADD CONSTRAINT approval_mail_requires_approval CHECK(approval_mail_status='none' OR status='approved'),
 ADD CONSTRAINT approval_mail_sent_time CHECK((approval_mail_status='sent')=(approval_mail_sent_at IS NOT NULL));
ALTER TABLE schoolvault.admission_audit DROP CONSTRAINT admission_audit_action_check;
ALTER TABLE schoolvault.admission_audit ADD CONSTRAINT admission_audit_action_check
 CHECK(action IN('approved','declined','approval-email-sent','approval-email-failed','approval-email-unknown'));

-- Like migration 021, the runtime role reaches these rows only through functions keyed by a
-- live admin session hash. A send interrupted before its result was saved stays 'sending'
-- and is reported as 'unknown' after two minutes.
GRANT CREATE ON SCHEMA schoolvault TO schoolvault_definer;
CREATE FUNCTION schoolvault.admin_access_requests_mail(p_admin_hash text)
RETURNS TABLE(id uuid,email text,name text,acadia_student boolean,status text,created_at timestamptz,decided_at timestamptz,
 approval_mail text,approval_mail_transport text,approval_mail_sent_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
 SELECT r.id,r.email,r.name,r.acadia_student,r.status,r.created_at,r.decided_at,
  CASE WHEN r.approval_mail_status='sending' AND r.approval_mail_attempted_at<now()-interval '2 minutes' THEN 'unknown' ELSE r.approval_mail_status END,
  r.approval_mail_transport,r.approval_mail_sent_at
 FROM schoolvault.access_requests r
 WHERE schoolvault.admin_session_email(p_admin_hash) IS NOT NULL ORDER BY r.created_at DESC LIMIT 200
$$;
-- Returns 'claimed' with the recipient, or the reason nothing was claimed (no recipient).
CREATE FUNCTION schoolvault.admin_claim_approval_mail(p_admin_hash text,p_id uuid,p_transport text,p_confirm_unknown boolean)
RETURNS TABLE(outcome text,email text,name text,origin text,attempt uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
DECLARE r record;v_state text;
BEGIN
 IF schoolvault.admin_session_email(p_admin_hash) IS NULL THEN RETURN QUERY SELECT 'unauthorized'::text,NULL::text,NULL::text,NULL::text,NULL::uuid;RETURN;END IF;
 IF p_transport IS NULL OR p_transport NOT IN('gmail','log') THEN RAISE EXCEPTION 'Invalid approval mail transport';END IF;
 SELECT a.email,a.name,a.status,a.approval_mail_status,a.approval_mail_attempted_at INTO r
  FROM schoolvault.access_requests a WHERE a.id=p_id FOR UPDATE;
 IF NOT FOUND THEN RETURN QUERY SELECT 'not-found'::text,NULL::text,NULL::text,NULL::text,NULL::uuid;RETURN;END IF;
 IF r.status<>'approved' THEN RETURN QUERY SELECT 'not-approved'::text,NULL::text,NULL::text,NULL::text,NULL::uuid;RETURN;END IF;
 v_state:=CASE WHEN r.approval_mail_status='sending' AND r.approval_mail_attempted_at<now()-interval '2 minutes' THEN 'unknown' ELSE r.approval_mail_status END;
 IF v_state IN('sent','sending') OR (v_state='unknown' AND p_confirm_unknown IS NOT TRUE) THEN
  RETURN QUERY SELECT v_state,NULL::text,NULL::text,NULL::text,NULL::uuid;RETURN;
 END IF;
 UPDATE schoolvault.access_requests SET approval_mail_status='sending',approval_mail_transport=p_transport,
  approval_mail_attempts=approval_mail_attempts+1,approval_mail_attempted_at=now(),approval_mail_attempt=gen_random_uuid() WHERE id=p_id;
 RETURN QUERY SELECT 'claimed'::text,r.email,r.name,'request'::text,a.approval_mail_attempt FROM schoolvault.access_requests a WHERE a.id=p_id;
END $$;
-- Records the outcome of a claimed send. The audit's admin email comes from the session row.
CREATE FUNCTION schoolvault.admin_record_approval_mail(p_admin_hash text,p_id uuid,p_outcome text,p_audit_id uuid,p_attempt uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
DECLARE v_admin text;
BEGIN
 v_admin:=schoolvault.admin_session_email(p_admin_hash);
 IF v_admin IS NULL OR p_outcome IS NULL OR p_outcome NOT IN('sent','failed','unknown') THEN RETURN false;END IF;
 UPDATE schoolvault.access_requests SET approval_mail_status=p_outcome,
  approval_mail_sent_at=CASE WHEN p_outcome='sent' THEN now() END
  WHERE id=p_id AND approval_mail_status='sending' AND approval_mail_attempt=p_attempt;
 IF NOT FOUND THEN RETURN false;END IF;
 INSERT INTO schoolvault.admission_audit(id,admin_email,request_id,action) VALUES(p_audit_id,v_admin,p_id,'approval-email-'||p_outcome);
 RETURN true;
END $$;
DO $$ DECLARE f regprocedure; BEGIN
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='schoolvault' AND p.proname IN('admin_access_requests_mail','admin_claim_approval_mail','admin_record_approval_mail') LOOP
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
