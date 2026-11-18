// Operator job: embed passages that have no vector yet (B2 backfill).
//   NEYVU_BACKFILL_DATABASE_URL=postgres://… node_modules/.bin/tsx services/answer/retrieval/backfill.ts [--all-versions]
// Runs one tenant transaction at a time (RLS applies via schoolvault.user_id).
// Refuses non-loopback databases unless NEYVU_BACKFILL_ALLOW_REMOTE=1 (owner decision).
import {Client} from 'pg';
import {backfillTenantEmbeddings} from '../../../lib/beta/embedding-backfill';
import {retrievalConfig} from '../../../lib/beta/retrieval-config';

async function main(){
 const url=new URL(process.env.NEYVU_BACKFILL_DATABASE_URL||'');
 if(!['127.0.0.1','localhost'].includes(url.hostname)&&process.env.NEYVU_BACKFILL_ALLOW_REMOTE!=='1')throw Error('Backfill is limited to a loopback database');
 const cfg=retrievalConfig({...process.env,NEYVU_RETRIEVAL:'hybrid'});
 if(!cfg.embedUrl)throw Error('Set NEYVU_EMBED_URL to the local embed service');
 const c=new Client({connectionString:url.href});await c.connect();
 try{
  const users=(await c.query('SELECT id FROM schoolvault.users WHERE disabled_at IS NULL ORDER BY id')).rows;
  for(const {id} of users){
   for(;;){
    await c.query('BEGIN');await c.query("SELECT set_config('schoolvault.user_id',$1,true)",[id]);
    const out=await backfillTenantEmbeddings(c as any,id,{limit:256,currentOnly:!process.argv.includes('--all-versions')},cfg);
    await c.query('COMMIT');
    console.log(JSON.stringify({tenant:id.slice(0,8),...out}));
    if(out.candidates<256)break;
   }
  }
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{await c.end();}
}
main().catch(e=>{console.error(e instanceof Error?e.message:'backfill failed');process.exitCode=1;});
