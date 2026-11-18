BEGIN;
-- Student emails follow the language the student used on the site. Existing requests keep English.
ALTER TABLE schoolvault.access_requests
 ADD COLUMN language text NOT NULL DEFAULT 'en' CHECK(language IN('en','es'));
GRANT CREATE ON SCHEMA schoolvault TO schoolvault_definer;
-- Called in the same transaction as request_access. Only the row that call just created can change:
-- a repeated request for an existing email has another id, so it cannot relabel the earlier one.
CREATE FUNCTION schoolvault.set_request_language(p_id uuid,p_email text,p_language text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
BEGIN
 IF p_language IS NULL OR p_language NOT IN('en','es') THEN RETURN false;END IF;
 UPDATE schoolvault.access_requests SET language=p_language
 WHERE id=p_id AND email=p_email AND origin='request' AND status='pending' AND created_at>now()-interval '1 minute';
 RETURN FOUND;
END $$;
-- Invitations take the language the admin chose when creating them.
CREATE FUNCTION schoolvault.admin_set_request_language(p_admin_hash text,p_id uuid,p_language text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
BEGIN
 IF schoolvault.admin_session_email(p_admin_hash) IS NULL OR p_language IS NULL OR p_language NOT IN('en','es') THEN RETURN false;END IF;
 UPDATE schoolvault.access_requests SET language=p_language WHERE id=p_id;
 RETURN FOUND;
END $$;
CREATE FUNCTION schoolvault.admin_request_language(p_admin_hash text,p_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
 SELECT r.language FROM schoolvault.access_requests r
 WHERE r.id=p_id AND schoolvault.admin_session_email(p_admin_hash) IS NOT NULL
$$;
DO $$ DECLARE f regprocedure; BEGIN
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='schoolvault' AND p.proname IN('set_request_language','admin_set_request_language','admin_request_language') LOOP
 EXECUTE format('ALTER FUNCTION %s OWNER TO schoolvault_definer',f);END LOOP;
END $$;
SET LOCAL ROLE schoolvault_definer;
DO $$ DECLARE f regprocedure; BEGIN
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='schoolvault' AND p.proname IN('set_request_language','admin_set_request_language','admin_request_language') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO schoolvault_web',f);END LOOP;
END $$;
SET LOCAL ROLE NONE;
REVOKE CREATE ON SCHEMA schoolvault FROM schoolvault_definer;
COMMIT;
