BEGIN;
CREATE TABLE schoolvault.class_sessions (
 user_id uuid NOT NULL,id uuid NOT NULL,course_id uuid NOT NULL,request_id uuid NOT NULL,
 request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 180),recorded_at timestamptz NOT NULL,
 timezone text NOT NULL CHECK(length(timezone)<=100),permission_note text NOT NULL CHECK(length(permission_note) BETWEEN 1 AND 500),
 mime text NOT NULL CHECK(mime IN('audio/webm','audio/mp4','audio/ogg','audio/wav','audio/mpeg')),
 material_versions jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(material_versions)='array'),
 state text NOT NULL DEFAULT 'capturing' CHECK(state IN('capturing','sealed')),
 manifest_sha256 text CHECK(manifest_sha256 ~ '^[a-f0-9]{64}$'),duration_ms integer CHECK(duration_ms BETWEEN 1 AND 7200000),
 total_bytes bigint NOT NULL DEFAULT 0 CHECK(total_bytes BETWEEN 0 AND 134217728),
 transcript_source_id uuid,current_transcript uuid,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,id),UNIQUE(user_id,request_id),
 FOREIGN KEY(user_id,course_id) REFERENCES schoolvault.courses(user_id,id),
 FOREIGN KEY(user_id,transcript_source_id,course_id) REFERENCES schoolvault.sources(user_id,id,course_id),
 CHECK((state='capturing' AND manifest_sha256 IS NULL AND duration_ms IS NULL) OR (state='sealed' AND manifest_sha256 IS NOT NULL AND duration_ms IS NOT NULL AND total_bytes>0))
);
CREATE TABLE schoolvault.class_audio_chunks (
 user_id uuid NOT NULL,id uuid NOT NULL,session_id uuid NOT NULL,sequence integer NOT NULL CHECK(sequence BETWEEN 0 AND 1023),
 object_key uuid NOT NULL,sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 4194304),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,id),UNIQUE(user_id,session_id,sequence),UNIQUE(user_id,object_key),
 FOREIGN KEY(user_id,session_id) REFERENCES schoolvault.class_sessions(user_id,id)
);
CREATE TABLE schoolvault.class_transcripts (
 user_id uuid NOT NULL,id uuid NOT NULL,session_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),
 request_id uuid NOT NULL,request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
 audio_manifest_sha256 text NOT NULL CHECK(audio_manifest_sha256 ~ '^[a-f0-9]{64}$'),
 source_id uuid NOT NULL,version_id uuid NOT NULL,parent_id uuid,
 language text NOT NULL CHECK(length(language) BETWEEN 2 AND 20),
 segments jsonb NOT NULL CHECK(jsonb_typeof(segments)='array'),
 provenance text NOT NULL CHECK(provenance IN('local_machine_transcript','student_correction')),
 runtime jsonb NOT NULL CHECK(jsonb_typeof(runtime)='object'),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,id),UNIQUE(user_id,session_id,id),UNIQUE(user_id,session_id,revision),UNIQUE(user_id,session_id,request_id),
 FOREIGN KEY(user_id,session_id) REFERENCES schoolvault.class_sessions(user_id,id),
 FOREIGN KEY(user_id,source_id,version_id) REFERENCES schoolvault.source_versions(user_id,source_id,id),
 FOREIGN KEY(user_id,session_id,parent_id) REFERENCES schoolvault.class_transcripts(user_id,session_id,id) DEFERRABLE INITIALLY DEFERRED,
 CHECK((provenance='local_machine_transcript' AND parent_id IS NULL AND revision=1) OR (provenance='student_correction' AND parent_id IS NOT NULL AND revision>1))
);
ALTER TABLE schoolvault.class_sessions ADD FOREIGN KEY(user_id,id,current_transcript)
 REFERENCES schoolvault.class_transcripts(user_id,session_id,id) DEFERRABLE INITIALLY DEFERRED;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['class_sessions','class_audio_chunks','class_transcripts'] LOOP
  EXECUTE format('ALTER TABLE schoolvault.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE schoolvault.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY %I ON schoolvault.%I USING(user_id=nullif(current_setting(''schoolvault.user_id'',true),'''')::uuid) WITH CHECK(user_id=nullif(current_setting(''schoolvault.user_id'',true),'''')::uuid)',t||'_tenant',t);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON schoolvault.class_sessions TO schoolvault_web;
GRANT SELECT,INSERT ON schoolvault.class_audio_chunks,schoolvault.class_transcripts TO schoolvault_web;
COMMIT;
