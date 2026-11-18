BEGIN;
CREATE TABLE schoolvault.student_memory (
 user_id uuid NOT NULL REFERENCES schoolvault.users(id),
 id uuid NOT NULL,
 request_id uuid NOT NULL,
 course_id uuid,
 chat_id uuid,
 kind text NOT NULL CHECK(kind IN ('choice','correction','preference','progress')),
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 1600),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,id),
 UNIQUE(user_id,request_id),
 FOREIGN KEY(user_id,course_id) REFERENCES schoolvault.courses(user_id,id),
 FOREIGN KEY(user_id,chat_id) REFERENCES schoolvault.chats(user_id,id)
);
CREATE INDEX student_memory_scope ON schoolvault.student_memory(user_id,course_id,chat_id,updated_at DESC);
ALTER TABLE schoolvault.student_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE schoolvault.student_memory FORCE ROW LEVEL SECURITY;
CREATE POLICY student_memory_tenant ON schoolvault.student_memory USING(user_id=nullif(current_setting('schoolvault.user_id',true),'')::uuid) WITH CHECK(user_id=nullif(current_setting('schoolvault.user_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON schoolvault.student_memory TO schoolvault_web;
COMMIT;
