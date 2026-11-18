BEGIN;
-- Additive delivery ledger. Requests remain the source of truth even when SMTP fails.
CREATE TABLE schoolvault.access_request_notifications (
 request_id uuid PRIMARY KEY REFERENCES schoolvault.access_requests(id),
 recipient text NOT NULL,attempt uuid NOT NULL,
 state text NOT NULL CHECK(state IN('sending','sent','failed','unknown')),
 attempted_at timestamptz NOT NULL DEFAULT now(),sent_at timestamptz,
 CHECK((state='sent')=(sent_at IS NOT NULL))
);
REVOKE ALL ON schoolvault.access_request_notifications FROM PUBLIC,schoolvault_web;
GRANT SELECT,INSERT,UPDATE ON schoolvault.access_request_notifications TO schoolvault_definer;
GRANT CREATE ON SCHEMA schoolvault TO schoolvault_definer;
-- The caller just inserted p_id. Repeated email requests have another id and cannot
-- claim or re-send the earlier notification. No old requests are backfilled.
CREATE FUNCTION schoolvault.claim_new_request_notice(p_id uuid,p_attempt uuid,p_recipient text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
BEGIN
 INSERT INTO schoolvault.access_request_notifications(request_id,recipient,attempt,state)
 SELECT r.id,p_recipient,p_attempt,'sending' FROM schoolvault.access_requests r
 WHERE r.id=p_id AND r.origin='request' AND r.status='pending' AND r.created_at>now()-interval '1 minute'
 ON CONFLICT(request_id) DO NOTHING;
 RETURN FOUND;
END $$;
CREATE FUNCTION schoolvault.record_request_notice(p_id uuid,p_attempt uuid,p_state text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
BEGIN
 IF p_state IS NULL OR p_state NOT IN('sent','failed','unknown') THEN RETURN false;END IF;
 UPDATE schoolvault.access_request_notifications SET state=p_state,sent_at=CASE WHEN p_state='sent' THEN now() END
 WHERE request_id=p_id AND attempt=p_attempt AND state='sending';RETURN FOUND;
END $$;
CREATE FUNCTION schoolvault.admin_request_notices(p_admin_hash text)
RETURNS TABLE(request_id uuid,notice_state text,recipient text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
 SELECT n.request_id,CASE WHEN n.state='sending' AND n.attempted_at<now()-interval '2 minutes' THEN 'unknown' ELSE n.state END,n.recipient
 FROM schoolvault.access_request_notifications n
 WHERE schoolvault.admin_session_email(p_admin_hash) IS NOT NULL
$$;
CREATE FUNCTION schoolvault.admin_retry_request_notice(p_admin_hash text,p_id uuid,p_recipient text,p_confirm_unknown boolean)
RETURNS TABLE(email text,name text,attempt uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
DECLARE n record;v_state text;v_attempt uuid;
BEGIN
 IF schoolvault.admin_session_email(p_admin_hash) IS NULL THEN RETURN;END IF;
 SELECT * INTO n FROM schoolvault.access_request_notifications WHERE request_id=p_id FOR UPDATE;
 IF NOT FOUND THEN RETURN;END IF;
 v_state:=CASE WHEN n.state='sending' AND n.attempted_at<now()-interval '2 minutes' THEN 'unknown' ELSE n.state END;
 IF v_state<>'failed' AND NOT(v_state='unknown' AND p_confirm_unknown IS TRUE) THEN RETURN;END IF;
 v_attempt:=gen_random_uuid();
 UPDATE schoolvault.access_request_notifications SET state='sending',attempt=v_attempt,recipient=p_recipient,attempted_at=now(),sent_at=NULL WHERE request_id=p_id;
 RETURN QUERY SELECT r.email,r.name,v_attempt FROM schoolvault.access_requests r WHERE r.id=p_id;
END $$;
DO $$ DECLARE f regprocedure; BEGIN
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='schoolvault' AND p.proname IN('claim_new_request_notice','record_request_notice','admin_request_notices','admin_retry_request_notice') LOOP
 EXECUTE format('ALTER FUNCTION %s OWNER TO schoolvault_definer',f);END LOOP;
END $$;
SET LOCAL ROLE schoolvault_definer;
DO $$ DECLARE f regprocedure; BEGIN
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='schoolvault' AND p.proname IN('claim_new_request_notice','record_request_notice','admin_request_notices','admin_retry_request_notice') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO schoolvault_web',f);END LOOP;
END $$;
SET LOCAL ROLE NONE;
REVOKE CREATE ON SCHEMA schoolvault FROM schoolvault_definer;
COMMIT;
