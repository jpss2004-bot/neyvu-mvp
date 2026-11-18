BEGIN;
-- D1 knowledge graph (build/knowledge, 2026-11-12). Learner-scoped entities,
-- relations and their evidence. Every entity and edge names what proves it:
-- a source version (documents, Moodle captures) or a platform record
-- (course/group rows), never model prose alone. Validity times bound when a
-- fact holds; superseded facts are kept with valid_to set, not deleted.
-- Read by the worker only through scripts/knowledge_graph.py behind
-- SCHOOL_BETA_KNOWLEDGE_GRAPH (default off).
CREATE TABLE schoolvault.kg_entities (
 user_id uuid NOT NULL REFERENCES schoolvault.users(id),
 id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('course','section','activity','deadline','requirement','document_version','person','place','policy','service')),
 -- Stable natural key from the extractor, e.g. 'activity:<course>:lab-3'.
 key text NOT NULL CHECK(length(key) BETWEEN 1 AND 400),
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 400),
 attrs jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(attrs)='object'),
 course_id uuid,
 source_id uuid,
 version_id uuid,
 proof_ref text CHECK(proof_ref IS NULL OR length(proof_ref)<=400),
 authority text NOT NULL CHECK(authority IN ('platform','document','student_reported')),
 extractor text NOT NULL CHECK(length(extractor) BETWEEN 1 AND 80),
 confidence numeric NOT NULL DEFAULT 1 CHECK(confidence>=0 AND confidence<=1),
 valid_from timestamptz NOT NULL DEFAULT now(),
 valid_to timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,id),
 UNIQUE(user_id,key,valid_from),
 CHECK(valid_to IS NULL OR valid_to>valid_from),
 CHECK(version_id IS NOT NULL OR proof_ref IS NOT NULL),
 CHECK((source_id IS NULL)=(version_id IS NULL)),
 FOREIGN KEY(user_id,course_id) REFERENCES schoolvault.courses(user_id,id),
 FOREIGN KEY(user_id,source_id,version_id) REFERENCES schoolvault.source_versions(user_id,source_id,id)
);
-- One current row per key.
CREATE UNIQUE INDEX kg_entities_current ON schoolvault.kg_entities(user_id,key) WHERE valid_to IS NULL;
CREATE INDEX kg_entities_kind ON schoolvault.kg_entities(user_id,course_id,kind) WHERE valid_to IS NULL;

CREATE TABLE schoolvault.kg_edges (
 user_id uuid NOT NULL REFERENCES schoolvault.users(id),
 id uuid NOT NULL,
 relation text NOT NULL CHECK(relation IN ('applies_to','supersedes','due_at','part_of','requires')),
 from_entity uuid NOT NULL,
 to_entity uuid NOT NULL,
 attrs jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(attrs)='object'),
 source_id uuid,
 version_id uuid,
 proof_ref text CHECK(proof_ref IS NULL OR length(proof_ref)<=400),
 authority text NOT NULL CHECK(authority IN ('platform','document','student_reported')),
 extractor text NOT NULL CHECK(length(extractor) BETWEEN 1 AND 80),
 confidence numeric NOT NULL DEFAULT 1 CHECK(confidence>=0 AND confidence<=1),
 valid_from timestamptz NOT NULL DEFAULT now(),
 valid_to timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,id),
 CHECK(from_entity<>to_entity),
 CHECK(valid_to IS NULL OR valid_to>valid_from),
 CHECK(version_id IS NOT NULL OR proof_ref IS NOT NULL),
 CHECK((source_id IS NULL)=(version_id IS NULL)),
 FOREIGN KEY(user_id,from_entity) REFERENCES schoolvault.kg_entities(user_id,id),
 FOREIGN KEY(user_id,to_entity) REFERENCES schoolvault.kg_entities(user_id,id),
 FOREIGN KEY(user_id,source_id,version_id) REFERENCES schoolvault.source_versions(user_id,source_id,id)
);
CREATE UNIQUE INDEX kg_edges_current ON schoolvault.kg_edges(user_id,relation,from_entity,to_entity) WHERE valid_to IS NULL;
CREATE INDEX kg_edges_to ON schoolvault.kg_edges(user_id,to_entity,relation) WHERE valid_to IS NULL;

-- Pinned source passages behind an entity or edge (model-assisted extraction
-- must keep the exact quote it read, with its confidence).
CREATE TABLE schoolvault.kg_evidence (
 user_id uuid NOT NULL REFERENCES schoolvault.users(id),
 id uuid NOT NULL,
 entity_id uuid,
 edge_id uuid,
 source_id uuid NOT NULL,
 version_id uuid NOT NULL,
 passage_id uuid,
 quote text NOT NULL CHECK(length(quote) BETWEEN 1 AND 2000),
 char_start integer CHECK(char_start IS NULL OR char_start>=0),
 char_end integer,
 extractor text NOT NULL CHECK(length(extractor) BETWEEN 1 AND 80),
 confidence numeric NOT NULL CHECK(confidence>=0 AND confidence<=1),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,id),
 CHECK((entity_id IS NULL)<>(edge_id IS NULL)),
 CHECK(char_end IS NULL OR char_start IS NOT NULL AND char_end>char_start),
 FOREIGN KEY(user_id,entity_id) REFERENCES schoolvault.kg_entities(user_id,id),
 FOREIGN KEY(user_id,edge_id) REFERENCES schoolvault.kg_edges(user_id,id),
 FOREIGN KEY(user_id,source_id,version_id) REFERENCES schoolvault.source_versions(user_id,source_id,id),
 FOREIGN KEY(user_id,passage_id) REFERENCES schoolvault.passages(user_id,id)
);
CREATE INDEX kg_evidence_entity ON schoolvault.kg_evidence(user_id,entity_id) WHERE entity_id IS NOT NULL;
CREATE INDEX kg_evidence_edge ON schoolvault.kg_evidence(user_id,edge_id) WHERE edge_id IS NOT NULL;

ALTER TABLE schoolvault.kg_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE schoolvault.kg_entities FORCE ROW LEVEL SECURITY;
CREATE POLICY kg_entities_tenant ON schoolvault.kg_entities USING(user_id=nullif(current_setting('schoolvault.user_id',true),'')::uuid) WITH CHECK(user_id=nullif(current_setting('schoolvault.user_id',true),'')::uuid);
ALTER TABLE schoolvault.kg_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE schoolvault.kg_edges FORCE ROW LEVEL SECURITY;
CREATE POLICY kg_edges_tenant ON schoolvault.kg_edges USING(user_id=nullif(current_setting('schoolvault.user_id',true),'')::uuid) WITH CHECK(user_id=nullif(current_setting('schoolvault.user_id',true),'')::uuid);
ALTER TABLE schoolvault.kg_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE schoolvault.kg_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY kg_evidence_tenant ON schoolvault.kg_evidence USING(user_id=nullif(current_setting('schoolvault.user_id',true),'')::uuid) WITH CHECK(user_id=nullif(current_setting('schoolvault.user_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON schoolvault.kg_entities,schoolvault.kg_edges,schoolvault.kg_evidence TO schoolvault_web;
COMMIT;
