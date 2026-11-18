BEGIN;
-- Only reports explicitly shared by a student. Never copy chat/source contents.
CREATE TABLE schoolvault.pilot_reports (
 user_id uuid NOT NULL REFERENCES schoolvault.users(id), id uuid NOT NULL,
 email text NOT NULL, stage text NOT NULL, outcome text NOT NULL, device text NOT NULL,
 elapsed text NOT NULL, description text NOT NULL CHECK(length(description)<=1200),
 release text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,id)
);
ALTER TABLE schoolvault.pilot_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE schoolvault.pilot_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY own_reports ON schoolvault.pilot_reports
 USING(user_id=nullif(current_setting('schoolvault.user_id',true),'')::uuid)
 WITH CHECK(user_id=nullif(current_setting('schoolvault.user_id',true),'')::uuid);
CREATE POLICY review_shared_reports ON schoolvault.pilot_reports FOR SELECT
 USING(current_setting('schoolvault.report_admin',true)='verified');
GRANT SELECT,INSERT ON schoolvault.pilot_reports TO schoolvault_web;
CREATE INDEX pilot_reports_created ON schoolvault.pilot_reports(created_at DESC);
COMMIT;
