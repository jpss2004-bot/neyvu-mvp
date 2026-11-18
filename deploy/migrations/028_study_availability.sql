BEGIN;
ALTER TABLE schoolvault.student_memory DROP CONSTRAINT student_memory_kind_check;
ALTER TABLE schoolvault.student_memory ADD CONSTRAINT student_memory_kind_check CHECK(kind IN ('choice','correction','preference','progress','availability'));
ALTER TABLE schoolvault.student_memory ADD CONSTRAINT student_availability_scope CHECK(kind!='availability' OR course_id IS NULL AND chat_id IS NULL);
CREATE UNIQUE INDEX student_availability_once ON schoolvault.student_memory(user_id) WHERE kind='availability';
COMMIT;
