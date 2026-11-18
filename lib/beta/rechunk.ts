// Re-chunk job (B5). Writes a NEW source version whose body, hash, original
// object and MIME are identical to the current one, with structure-aware
// passages (and vectors when the embed service is on). Old versions and their
// passages stay untouched, so pinned answers keep their exact evidence.
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {chunkDocument,chunkerVersion} from './chunking';
import {chunkContext,insertChunks,embedOnWrite} from './passage-writer';
import {sourceChanged} from './source-dependencies';
import {checkHistory,lockVault} from './budget';

// Current versions whose passages were not cut by the structure chunker.
export async function rechunkCandidates(c:Pick<PoolClient,'query'>,user:string,limit=200){
 return (await c.query(`SELECT s.id,s.title,s.current_version FROM schoolvault.sources s
  WHERE s.user_id=$1 AND s.kind!='ai_draft' AND s.current_version IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM schoolvault.passages p WHERE p.user_id=s.user_id AND p.version_id=s.current_version AND p.chunker=$2)
  ORDER BY s.id LIMIT $3`,[user,chunkerVersion,limit])).rows as {id:string;title:string;current_version:string}[];
}

export async function rechunkSource(c:PoolClient,user:string,sourceId:string){
 await lockVault(c,user);
 const v=(await c.query('SELECT v.* FROM schoolvault.sources s JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.id=s.current_version WHERE s.user_id=$1 AND s.id=$2 FOR UPDATE OF s',[user,sourceId])).rows[0];
 if(!v)return {source_id:sourceId,status:'missing' as const};
 const chunks=chunkDocument(v.body,await chunkContext(c,user,sourceId));
 await c.query('SAVEPOINT rechunk');
 try{
  const version=randomUUID();
  await c.query('INSERT INTO schoolvault.source_versions(user_id,id,source_id,body,sha256,object_key,mime,bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[user,version,sourceId,v.body,v.sha256,v.object_key,v.mime,v.bytes]);
  const written=await insertChunks(c,user,sourceId,version,chunks,true);
  await c.query('UPDATE schoolvault.sources SET current_version=$3 WHERE user_id=$1 AND id=$2',[user,sourceId,version]);
  await sourceChanged(c,user,sourceId,version);
  await checkHistory(c,user);
  const embedded=await embedOnWrite(c,user,written);
  await c.query('RELEASE SAVEPOINT rechunk');
  return {source_id:sourceId,status:'rechunked' as const,previous_version:v.id,version,chunks:written.length,embedded};
 }catch(error){
  await c.query('ROLLBACK TO SAVEPOINT rechunk');await c.query('RELEASE SAVEPOINT rechunk');
  return {source_id:sourceId,status:'skipped' as const,reason:error instanceof Error&&error.message.startsWith('Invalid text:')?'text_quota':'error'};
 }
}
