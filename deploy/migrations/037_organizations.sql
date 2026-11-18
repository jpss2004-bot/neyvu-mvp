BEGIN;
-- E1 organization tenancy. Organizations sit above today's per-user isolation; they never
-- widen it. A membership grants access only to the organization's own tables below
-- (institution-public sources, journeys, aggregate usage). Learner content (courses,
-- sources, chats, notes, recordings) keeps its own user_id policies from 001 onward and
-- is never readable by an organization's staff or admins.

CREATE OR REPLACE FUNCTION schoolvault.actor_id() RETURNS uuid LANGUAGE sql STABLE
 AS $$SELECT nullif(current_setting('schoolvault.user_id',true),'')::uuid$$;

CREATE TABLE schoolvault.organizations (
 id uuid PRIMARY KEY,
 slug text UNIQUE NOT NULL CHECK(slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
 kind text NOT NULL DEFAULT 'university' CHECK(kind IN ('university','college','company','other')),
 -- Where this tenant's personal data must live (PIIDPA: Nova Scotia public bodies -> Canada).
 data_region text NOT NULL DEFAULT 'ca-central-1' CHECK(data_region IN ('ca-central-1','us')),
 settings jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(settings)='object'),
 created_at timestamptz NOT NULL DEFAULT now(), disabled_at timestamptz
);
CREATE TABLE schoolvault.org_memberships (
 org_id uuid NOT NULL REFERENCES schoolvault.organizations(id),
 user_id uuid NOT NULL REFERENCES schoolvault.users(id),
 role text NOT NULL CHECK(role IN ('learner','staff','admin')),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(org_id,user_id)
);
CREATE INDEX ON schoolvault.org_memberships(user_id);
CREATE TABLE schoolvault.org_invitations (
 org_id uuid NOT NULL REFERENCES schoolvault.organizations(id), id uuid NOT NULL,
 email_sha256 text NOT NULL CHECK(length(email_sha256)=64),
 role text NOT NULL CHECK(role IN ('learner','staff','admin')),
 token_sha256 text UNIQUE NOT NULL CHECK(length(token_sha256)=64),
 invited_by uuid NOT NULL REFERENCES schoolvault.users(id),
 expires_at timestamptz NOT NULL, accepted_at timestamptz, accepted_by uuid REFERENCES schoolvault.users(id), revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(org_id,id)
);
-- Institution-public knowledge: official pages, policies, service descriptions. Kept in its
-- own table with no user_id so it can never be confused with a learner's private sources.
CREATE TABLE schoolvault.org_public_sources (
 org_id uuid NOT NULL REFERENCES schoolvault.organizations(id), id uuid NOT NULL,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 300),
 url text NOT NULL CHECK(url ~ '^https://'),
 kind text NOT NULL DEFAULT 'page' CHECK(kind IN ('policy','calendar','service','faq','page','other')),
 body text NOT NULL DEFAULT '', sha256 text NOT NULL CHECK(length(sha256)=64),
 observed_at timestamptz NOT NULL DEFAULT now(),
 review_status text NOT NULL DEFAULT 'pending' CHECK(review_status IN ('pending','approved','flagged')),
 review_note text NOT NULL DEFAULT '', reviewed_by uuid REFERENCES schoolvault.users(id), reviewed_at timestamptz,
 created_by uuid REFERENCES schoolvault.users(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(org_id,id), UNIQUE(org_id,url)
);
CREATE INDEX org_public_source_search ON schoolvault.org_public_sources USING gin(to_tsvector('english',title||' '||body));
-- Onboarding journeys: clarify (questions to narrow the situation) -> official source -> route.
CREATE TABLE schoolvault.org_journeys (
 org_id uuid NOT NULL REFERENCES schoolvault.organizations(id), id uuid NOT NULL,
 slug text NOT NULL CHECK(slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 summary text NOT NULL DEFAULT '',
 clarify jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(clarify)='array' AND jsonb_array_length(clarify)<=12),
 official_source_id uuid,
 route jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(route)='object'),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
 updated_by uuid REFERENCES schoolvault.users(id), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(org_id,id), UNIQUE(org_id,slug),
 FOREIGN KEY(org_id,official_source_id) REFERENCES schoolvault.org_public_sources(org_id,id)
);
-- Aggregate counters only. No user id, no content.
CREATE TABLE schoolvault.org_usage_daily (
 org_id uuid NOT NULL REFERENCES schoolvault.organizations(id), day date NOT NULL,
 metric text NOT NULL CHECK(metric IN ('active_learners','questions','sources_added','journeys_opened','assistant_calls')),
 count bigint NOT NULL DEFAULT 0 CHECK(count>=0),
 PRIMARY KEY(org_id,day,metric)
);
-- Distinct-learner bookkeeping for active_learners. Unreadable by the runtime role.
CREATE TABLE schoolvault.org_usage_seen (
 org_id uuid NOT NULL REFERENCES schoolvault.organizations(id), day date NOT NULL, user_sha256 text NOT NULL,
 PRIMARY KEY(org_id,day,user_sha256)
);

-- Definer-owned helpers. Policies on the runtime role call org_role(); the definer role has
-- its own unconditional policy so the helper never recurses into the runtime policies.
GRANT USAGE,CREATE ON SCHEMA schoolvault TO schoolvault_definer;
GRANT SELECT ON schoolvault.organizations,schoolvault.org_memberships,schoolvault.org_invitations TO schoolvault_definer;
GRANT INSERT,UPDATE ON schoolvault.org_memberships,schoolvault.org_invitations TO schoolvault_definer;
GRANT SELECT,INSERT,UPDATE ON schoolvault.org_usage_daily,schoolvault.org_usage_seen TO schoolvault_definer;
GRANT SELECT(id,name,email,disabled_at,demo) ON schoolvault.users TO schoolvault_definer;

CREATE FUNCTION schoolvault.org_role(org uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,schoolvault AS $$
 SELECT m.role FROM schoolvault.org_memberships m JOIN schoolvault.organizations o ON o.id=m.org_id
 WHERE m.org_id=org AND m.user_id=schoolvault.actor_id() AND m.status='active' AND o.disabled_at IS NULL
$$;
CREATE FUNCTION schoolvault.my_organizations() RETURNS TABLE(org_id uuid,slug text,name text,role text) LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,schoolvault AS $$
 SELECT o.id,o.slug,o.name,m.role FROM schoolvault.org_memberships m JOIN schoolvault.organizations o ON o.id=m.org_id
 WHERE m.user_id=schoolvault.actor_id() AND m.status='active' AND o.disabled_at IS NULL ORDER BY o.name
$$;
-- Member directory for an organization's staff/admins: identity of members only, never content.
CREATE FUNCTION schoolvault.org_member_directory(org uuid) RETURNS TABLE(user_id uuid,name text,email text,role text,status text,joined_at timestamptz)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
BEGIN
 IF schoolvault.org_role(org) NOT IN ('staff','admin') OR schoolvault.org_role(org) IS NULL THEN RAISE EXCEPTION 'Not an organization administrator' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT m.user_id,u.name,u.email,m.role,m.status,m.created_at FROM schoolvault.org_memberships m JOIN schoolvault.users u ON u.id=m.user_id
  WHERE m.org_id=org ORDER BY m.role DESC,u.name;
END $$;
-- The signed-in learner redeems an invitation addressed to their verified email.
CREATE FUNCTION schoolvault.accept_org_invitation(token_hash text,email_hash text) RETURNS TABLE(org_id uuid,role text)
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
DECLARE inv record; actor uuid:=schoolvault.actor_id();
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Sign in first' USING ERRCODE='42501'; END IF;
 SELECT * INTO inv FROM schoolvault.org_invitations i WHERE i.token_sha256=token_hash FOR UPDATE;
 IF inv IS NULL OR inv.revoked_at IS NOT NULL OR inv.accepted_at IS NOT NULL OR inv.expires_at<now() OR inv.email_sha256<>email_hash THEN
  RAISE EXCEPTION 'Invitation is not valid for this account' USING ERRCODE='42501';
 END IF;
 INSERT INTO schoolvault.org_memberships(org_id,user_id,role) VALUES(inv.org_id,actor,inv.role)
  ON CONFLICT ON CONSTRAINT org_memberships_pkey DO UPDATE SET role=excluded.role,status='active',updated_at=now();
 UPDATE schoolvault.org_invitations SET accepted_at=now(),accepted_by=actor WHERE org_invitations.org_id=inv.org_id AND id=inv.id;
 RETURN QUERY SELECT inv.org_id,inv.role;
END $$;
-- Records an aggregate event for every organization the actor belongs to.
CREATE FUNCTION schoolvault.record_org_usage(metric_name text) RETURNS void
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,schoolvault AS $$
DECLARE actor uuid:=schoolvault.actor_id(); o uuid; today date:=(now() AT TIME ZONE 'UTC')::date;
BEGIN
 IF actor IS NULL OR metric_name NOT IN ('questions','sources_added','journeys_opened','assistant_calls') THEN RETURN; END IF;
 FOR o IN SELECT m.org_id FROM schoolvault.org_memberships m WHERE m.user_id=actor AND m.status='active' LOOP
  INSERT INTO schoolvault.org_usage_daily VALUES(o,today,metric_name,1) ON CONFLICT ON CONSTRAINT org_usage_daily_pkey DO UPDATE SET count=org_usage_daily.count+1;
  INSERT INTO schoolvault.org_usage_seen VALUES(o,today,encode(sha256(convert_to(o::text||':'||actor::text,'UTF8')),'hex')) ON CONFLICT DO NOTHING;
  IF FOUND THEN
   INSERT INTO schoolvault.org_usage_daily VALUES(o,today,'active_learners',1) ON CONFLICT ON CONSTRAINT org_usage_daily_pkey DO UPDATE SET count=org_usage_daily.count+1;
  END IF;
 END LOOP;
END $$;
ALTER FUNCTION schoolvault.org_role(uuid) OWNER TO schoolvault_definer;
ALTER FUNCTION schoolvault.my_organizations() OWNER TO schoolvault_definer;
ALTER FUNCTION schoolvault.org_member_directory(uuid) OWNER TO schoolvault_definer;
ALTER FUNCTION schoolvault.accept_org_invitation(text,text) OWNER TO schoolvault_definer;
ALTER FUNCTION schoolvault.record_org_usage(text) OWNER TO schoolvault_definer;
REVOKE ALL ON FUNCTION schoolvault.org_role(uuid),schoolvault.my_organizations(),schoolvault.org_member_directory(uuid),
 schoolvault.accept_org_invitation(text,text),schoolvault.record_org_usage(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION schoolvault.org_role(uuid),schoolvault.my_organizations(),schoolvault.org_member_directory(uuid),
 schoolvault.accept_org_invitation(text,text),schoolvault.record_org_usage(text),schoolvault.actor_id() TO schoolvault_web;
REVOKE CREATE ON SCHEMA schoolvault FROM schoolvault_definer;

-- Review and publication rules enforced in the database, not only in the console.
CREATE FUNCTION schoolvault.org_source_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.url IS DISTINCT FROM OLD.url OR NEW.body IS DISTINCT FROM OLD.body OR NEW.title IS DISTINCT FROM OLD.title) AND NEW.review_status=OLD.review_status THEN
  NEW.review_status:='pending'; NEW.reviewed_by:=NULL; NEW.reviewed_at:=NULL;   -- content changed: review again
 END IF;
 IF NEW.review_status='approved' AND (TG_OP='INSERT' OR OLD.review_status<>'approved') THEN
  IF schoolvault.org_role(NEW.org_id) IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Only an organization admin can approve a source' USING ERRCODE='42501'; END IF;
  NEW.reviewed_by:=schoolvault.actor_id(); NEW.reviewed_at:=now();
 ELSIF NEW.review_status='flagged' AND (TG_OP='INSERT' OR OLD.review_status<>'flagged') THEN
  NEW.reviewed_by:=schoolvault.actor_id(); NEW.reviewed_at:=now();
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER org_source_review BEFORE INSERT OR UPDATE ON schoolvault.org_public_sources FOR EACH ROW EXECUTE FUNCTION schoolvault.org_source_review_guard();
CREATE FUNCTION schoolvault.org_journey_publish_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='published' THEN
  IF NEW.official_source_id IS NULL OR NOT EXISTS(SELECT 1 FROM schoolvault.org_public_sources s WHERE s.org_id=NEW.org_id AND s.id=NEW.official_source_id AND s.review_status='approved') THEN
   RAISE EXCEPTION 'A journey can be published only with an approved official source' USING ERRCODE='23514';
  END IF;
  IF jsonb_array_length(NEW.clarify)=0 OR coalesce(NEW.route->>'label','')='' THEN
   RAISE EXCEPTION 'A published journey needs clarifying questions and a route' USING ERRCODE='23514';
  END IF;
 END IF;
 NEW.updated_at:=now(); NEW.updated_by:=schoolvault.actor_id();
 RETURN NEW;
END $$;
CREATE TRIGGER org_journey_publish BEFORE INSERT OR UPDATE ON schoolvault.org_journeys FOR EACH ROW EXECUTE FUNCTION schoolvault.org_journey_publish_guard();
-- An organization always keeps at least one active admin.
CREATE FUNCTION schoolvault.org_last_admin_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org uuid:=CASE WHEN TG_OP='DELETE' THEN OLD.org_id ELSE NEW.org_id END;
BEGIN
 IF OLD.role='admin' AND OLD.status='active' AND schoolvault.org_role(org)='admin' AND NOT EXISTS(
  SELECT 1 FROM schoolvault.org_memberships m WHERE m.org_id=org AND m.role='admin' AND m.status='active' AND m.user_id<>OLD.user_id) AND
  (TG_OP='DELETE' OR NEW.role<>'admin' OR NEW.status<>'active') THEN
  RAISE EXCEPTION 'An organization needs at least one active admin' USING ERRCODE='23514';
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER org_last_admin BEFORE UPDATE OR DELETE ON schoolvault.org_memberships FOR EACH ROW EXECUTE FUNCTION schoolvault.org_last_admin_guard();

-- Row-level security. Runtime policies are scoped TO schoolvault_web; the definer role gets
-- its own unconditional policy for the narrow functions above.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['organizations','org_memberships','org_invitations','org_public_sources','org_journeys','org_usage_daily','org_usage_seen'] LOOP
  EXECUTE format('ALTER TABLE schoolvault.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE schoolvault.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY definer_lookup ON schoolvault.%I TO schoolvault_definer USING (true) WITH CHECK (true)',t);
 END LOOP;
END $$;
CREATE POLICY member_read ON schoolvault.organizations FOR SELECT TO schoolvault_web USING (schoolvault.org_role(id) IS NOT NULL);
CREATE POLICY admin_update ON schoolvault.organizations FOR UPDATE TO schoolvault_web USING (schoolvault.org_role(id)='admin') WITH CHECK (schoolvault.org_role(id)='admin');
CREATE POLICY own_or_staff_read ON schoolvault.org_memberships FOR SELECT TO schoolvault_web
 USING (user_id=schoolvault.actor_id() OR schoolvault.org_role(org_id) IN ('staff','admin'));
-- No runtime INSERT: people join only by accepting an invitation (accept_org_invitation),
-- so an admin cannot enrol an account without that person's action.
CREATE POLICY admin_update ON schoolvault.org_memberships FOR UPDATE TO schoolvault_web USING (schoolvault.org_role(org_id)='admin') WITH CHECK (schoolvault.org_role(org_id)='admin');
CREATE POLICY admin_delete ON schoolvault.org_memberships FOR DELETE TO schoolvault_web USING (schoolvault.org_role(org_id)='admin');
CREATE POLICY admin_all ON schoolvault.org_invitations TO schoolvault_web USING (schoolvault.org_role(org_id)='admin') WITH CHECK (schoolvault.org_role(org_id)='admin');
CREATE POLICY reviewed_read ON schoolvault.org_public_sources FOR SELECT TO schoolvault_web
 USING (schoolvault.org_role(org_id) IN ('staff','admin') OR (review_status='approved' AND schoolvault.org_role(org_id) IS NOT NULL));
CREATE POLICY staff_insert ON schoolvault.org_public_sources FOR INSERT TO schoolvault_web WITH CHECK (schoolvault.org_role(org_id) IN ('staff','admin'));
CREATE POLICY staff_update ON schoolvault.org_public_sources FOR UPDATE TO schoolvault_web USING (schoolvault.org_role(org_id) IN ('staff','admin')) WITH CHECK (schoolvault.org_role(org_id) IN ('staff','admin'));
CREATE POLICY admin_delete ON schoolvault.org_public_sources FOR DELETE TO schoolvault_web USING (schoolvault.org_role(org_id)='admin');
CREATE POLICY published_read ON schoolvault.org_journeys FOR SELECT TO schoolvault_web
 USING (schoolvault.org_role(org_id) IN ('staff','admin') OR (status='published' AND schoolvault.org_role(org_id) IS NOT NULL));
CREATE POLICY staff_write ON schoolvault.org_journeys FOR INSERT TO schoolvault_web WITH CHECK (schoolvault.org_role(org_id) IN ('staff','admin'));
CREATE POLICY staff_update ON schoolvault.org_journeys FOR UPDATE TO schoolvault_web USING (schoolvault.org_role(org_id) IN ('staff','admin')) WITH CHECK (schoolvault.org_role(org_id) IN ('staff','admin'));
CREATE POLICY admin_delete ON schoolvault.org_journeys FOR DELETE TO schoolvault_web USING (schoolvault.org_role(org_id)='admin');
CREATE POLICY admin_read ON schoolvault.org_usage_daily FOR SELECT TO schoolvault_web USING (schoolvault.org_role(org_id)='admin');

GRANT SELECT,UPDATE(name,settings) ON schoolvault.organizations TO schoolvault_web;
GRANT SELECT,UPDATE(role,status,updated_at),DELETE ON schoolvault.org_memberships TO schoolvault_web;
GRANT SELECT,INSERT,UPDATE(revoked_at),DELETE ON schoolvault.org_invitations TO schoolvault_web;
GRANT SELECT,INSERT,UPDATE,DELETE ON schoolvault.org_public_sources,schoolvault.org_journeys TO schoolvault_web;
GRANT SELECT ON schoolvault.org_usage_daily TO schoolvault_web;
REVOKE ALL ON schoolvault.org_usage_seen FROM schoolvault_web;
COMMIT;
