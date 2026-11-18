BEGIN;
-- Workstream B2: dense vectors for hybrid retrieval. Passages are immutable to
-- the runtime role (002 revokes UPDATE), so vectors live in a side table keyed
-- by passage and model. The dimension is per model; each model gets its own
-- expression index. Filters (tenant, course, authority) apply in SQL before
-- any vector ranking; RLS keeps every row tenant-private.
-- pgvector is optional at migration time. Where the extension can be created
-- (it must be available and allowed for this role), embeddings use the vector
-- type with an approximate index. Otherwise the table is created with a real[]
-- column so tenant recovery and account deletion keep one schema everywhere;
-- hybrid retrieval stays unavailable there (NEYVU_RETRIEVAL=hybrid needs pgvector)
-- until a later migration converts the column.
DO $migration$
DECLARE has_vector boolean := false;
BEGIN
 IF EXISTS(SELECT 1 FROM pg_available_extensions WHERE name='vector') THEN
  BEGIN
   CREATE EXTENSION IF NOT EXISTS vector;
  EXCEPTION WHEN insufficient_privilege OR feature_not_supported OR undefined_file THEN
   RAISE NOTICE 'pgvector not created (%); passage_embeddings uses real[]', SQLERRM;
  END;
 END IF;
 has_vector := EXISTS(SELECT 1 FROM pg_extension WHERE extname='vector');
 IF has_vector THEN
  EXECUTE 'CREATE TABLE schoolvault.passage_embeddings (
   user_id uuid NOT NULL, passage_id uuid NOT NULL,
   model text NOT NULL CHECK(length(model) BETWEEN 1 AND 160),
   dim integer NOT NULL CHECK(dim BETWEEN 1 AND 4096),
   embedding vector NOT NULL CHECK(vector_dims(embedding)=dim),
   input_sha256 text NOT NULL CHECK(length(input_sha256)=64),
   created_at timestamptz NOT NULL DEFAULT now(),
   PRIMARY KEY(user_id,passage_id,model),
   FOREIGN KEY(user_id,passage_id) REFERENCES schoolvault.passages(user_id,id) ON DELETE CASCADE)';
  -- Approximate index for the default 384-dimension model (paraphrase-multilingual-MiniLM-L12-v2).
  EXECUTE 'CREATE INDEX passage_embeddings_hnsw_384 ON schoolvault.passage_embeddings
   USING hnsw ((embedding::vector(384)) vector_cosine_ops) WHERE dim=384';
 ELSE
  EXECUTE 'CREATE TABLE schoolvault.passage_embeddings (
   user_id uuid NOT NULL, passage_id uuid NOT NULL,
   model text NOT NULL CHECK(length(model) BETWEEN 1 AND 160),
   dim integer NOT NULL CHECK(dim BETWEEN 1 AND 4096),
   embedding real[] NOT NULL CHECK(cardinality(embedding)=dim),
   input_sha256 text NOT NULL CHECK(length(input_sha256)=64),
   created_at timestamptz NOT NULL DEFAULT now(),
   PRIMARY KEY(user_id,passage_id,model),
   FOREIGN KEY(user_id,passage_id) REFERENCES schoolvault.passages(user_id,id) ON DELETE CASCADE)';
 END IF;
END
$migration$;
CREATE INDEX passage_embeddings_user_model ON schoolvault.passage_embeddings(user_id,model);
ALTER TABLE schoolvault.passage_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE schoolvault.passage_embeddings FORCE ROW LEVEL SECURITY;
CREATE POLICY passage_embeddings_tenant ON schoolvault.passage_embeddings USING(user_id=nullif(current_setting('schoolvault.user_id',true),'')::uuid) WITH CHECK(user_id=nullif(current_setting('schoolvault.user_id',true),'')::uuid);
GRANT SELECT,INSERT,DELETE ON schoolvault.passage_embeddings TO schoolvault_web;
COMMIT;
