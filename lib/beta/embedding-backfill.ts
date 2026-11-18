// Backfill job (B2): embeds every current passage of one tenant that has no
// vector for the configured model. Idempotent and resumable; runs inside the
// caller's tenant transaction so RLS applies.
import type {PoolClient} from 'pg';
import {retrievalConfig} from './retrieval-config';
import {storePassageEmbeddings} from './embedding-client';

export async function backfillTenantEmbeddings(c:PoolClient,user:string,opts:{limit?:number;currentOnly?:boolean}={},cfg=retrievalConfig()){
 const limit=opts.limit??5000;
 const rows=(await c.query(`SELECT p.id,p.body,p.context_header FROM schoolvault.passages p
  JOIN schoolvault.sources s ON s.user_id=p.user_id AND s.id=p.source_id
  WHERE p.user_id=$1 AND s.kind!='ai_draft' AND ($3::boolean IS NOT TRUE OR p.version_id=s.current_version)
  AND NOT EXISTS(SELECT 1 FROM schoolvault.passage_embeddings e WHERE e.user_id=p.user_id AND e.passage_id=p.id AND e.model=$2)
  ORDER BY (p.version_id=s.current_version) DESC,p.source_id,p.ordinal LIMIT $4`,[user,cfg.embedModel,opts.currentOnly??true,limit])).rows;
 const stored=rows.length?await storePassageEmbeddings(c,user,rows,cfg):0;
 return {candidates:rows.length,stored,model:cfg.embedModel};
}
