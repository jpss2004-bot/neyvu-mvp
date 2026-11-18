BEGIN;
-- Workstream B5: structure-aware chunks. Existing rows keep NULLs (legacy
-- fixed slices). New versions written with NEYVU_CHUNKER=structure, or by the
-- re-chunk job, record how and where each chunk was cut. Body stays verbatim.
ALTER TABLE schoolvault.passages
 ADD COLUMN chunker text CHECK(length(chunker)<=40),
 ADD COLUMN section text CHECK(length(section)<=240),
 ADD COLUMN chunk_kind text CHECK(chunk_kind IN ('heading','page','slide','table','text')),
 ADD COLUMN context_header text CHECK(length(context_header)<=1000),
 ADD COLUMN start_offset integer CHECK(start_offset>=0),
 ADD COLUMN end_offset integer CHECK(end_offset>=start_offset);
COMMIT;
