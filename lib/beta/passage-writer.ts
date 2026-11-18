// One place that turns a saved version body into passages (B5) and, when
// enabled, embeds them in the same transaction (B2 on-write job). With every
// flag off it writes exactly the legacy 4,000/3,500 slices and nothing else.
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {chunkDocument,chunkerVersion,legacyChunks,structureChunkingEnabled,type Chunk} from './chunking';
import {retrievalConfig} from './retrieval-config';
import {storePassageEmbeddings} from './embedding-client';
import {queueGraphExtraction} from './graph-jobs';

export async function chunkContext(c:Pick<PoolClient,'query'>,user:string,source:string){
 const row=(await c.query('SELECT s.title,c.code,c.title AS course_title FROM schoolvault.sources s JOIN schoolvault.courses c ON c.user_id=s.user_id AND c.id=s.course_id WHERE s.user_id=$1 AND s.id=$2',[user,source])).rows[0];
 return {title:row?.title||null,course:row?[row.code,row.course_title].filter(Boolean).join(' — '):null};
}

export async function insertChunks(c:PoolClient,user:string,source:string,version:string,chunks:Chunk[],structured:boolean){
 const ids:{id:string;body:string;context_header:string|null}[]=[];
 for(const chunk of chunks){
  const id=randomUUID();
  if(structured)await c.query('INSERT INTO schoolvault.passages(user_id,id,source_id,version_id,ordinal,body,chunker,section,chunk_kind,context_header,start_offset,end_offset) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[user,id,source,version,chunk.ordinal,chunk.body,chunkerVersion,chunk.section?.slice(0,240)||null,chunk.kind,chunk.header.slice(0,1000)||null,chunk.start,chunk.end]);
  else await c.query('INSERT INTO schoolvault.passages(user_id,id,source_id,version_id,ordinal,body) VALUES($1,$2,$3,$4,$5,$6)',[user,id,source,version,chunk.ordinal,chunk.body]);
  ids.push({id,body:chunk.body,context_header:structured?chunk.header:null});
 }
 return ids;
}

// Best effort: an unavailable embed service never blocks saving a source.
// Missing vectors are filled later by services/answer/retrieval/backfill.ts.
export async function embedOnWrite(c:PoolClient,user:string,passages:{id:string;body:string;context_header:string|null}[]){
 const cfg=retrievalConfig();
 if(!cfg.embedOnWrite||!passages.length)return 0;
 await c.query('SAVEPOINT embed_on_write');
 try{const n=await storePassageEmbeddings(c,user,passages,cfg);await c.query('RELEASE SAVEPOINT embed_on_write');return n;}
 catch{await c.query('ROLLBACK TO SAVEPOINT embed_on_write');await c.query('RELEASE SAVEPOINT embed_on_write');return 0;}
}

export async function writePassages(c:PoolClient,user:string,source:string,version:string,body:string){
 const structured=structureChunkingEnabled();
 const chunks=structured?chunkDocument(body,await chunkContext(c,user,source)):legacyChunks(body);
 const written=await insertChunks(c,user,source,version,chunks,structured);
 await embedOnWrite(c,user,written);
 // SCHOOL_BETA_KNOWLEDGE_GRAPH=1: the course's graph is re-extracted from this version (lib/beta/graph-jobs.ts).
 await queueGraphExtraction(c,user,source,version,body);
 return written.length;
}
