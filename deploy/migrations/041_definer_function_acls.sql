BEGIN;
-- Migrations 037, 038 and 039 moved nine SECURITY DEFINER functions to
-- schoolvault_definer, then ran REVOKE/GRANT as the former owner. On
-- PostgreSQL 16+ a non-superuser maintenance role keeps only SET membership,
-- so those statements warned and changed nothing: PUBLIC kept EXECUTE and
-- schoolvault_web got no explicit grant (found in the Nov 12 rehearsal on a
-- production snapshot). Apply the ACLs as the exact NOLOGIN owner, as 021/022 do.
SET LOCAL ROLE schoolvault_definer;
REVOKE ALL ON FUNCTION
 schoolvault.org_role(uuid),schoolvault.my_organizations(),schoolvault.org_member_directory(uuid),
 schoolvault.accept_org_invitation(text,text),schoolvault.record_org_usage(text),
 schoolvault.redeem_oauth_code(text,text,text,text,text,text,int),schoolvault.refresh_oauth_token(text,text,text,text,int),
 schoolvault.oauth_access_actor(text),schoolvault.class_audio_pending_purge(int)
 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 schoolvault.org_role(uuid),schoolvault.my_organizations(),schoolvault.org_member_directory(uuid),
 schoolvault.accept_org_invitation(text,text),schoolvault.record_org_usage(text),
 schoolvault.redeem_oauth_code(text,text,text,text,text,text,int),schoolvault.refresh_oauth_token(text,text,text,text,int),
 schoolvault.oauth_access_actor(text),schoolvault.class_audio_pending_purge(int)
 TO schoolvault_web;
SET LOCAL ROLE NONE;
-- No SECURITY DEFINER function in the schema may remain executable by PUBLIC.
DO $$ DECLARE open text; BEGIN
 SELECT string_agg(p.oid::regprocedure::text,', ') INTO open FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='schoolvault' AND p.prosecdef AND has_function_privilege('public',p.oid,'EXECUTE');
 IF open IS NOT NULL THEN RAISE EXCEPTION 'SECURITY DEFINER functions still executable by PUBLIC: %',open; END IF;
END $$;
COMMIT;
