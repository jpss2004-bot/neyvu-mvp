// Operator job: re-chunk current sources with the structure chunker as new versions (B5).
//   NEYVU_RECHUNK_DATABASE_URL=postgres://… node_modules/.bin/tsx services/answer/retrieval/rechunk.ts [--apply] [--tenant <uuid>]
// Dry run by default (lists candidates). One tenant transaction per source; RLS applies.
// Set NEYVU_EMBED_ON_WRITE=1 with the embed service running to embed the new passages too.
import {Client} from 'pg';
import {rechunkCandidates,rechunkSource} from '../../../lib/beta/rechunk';

async function main(){
 const url=new URL(process.env.NEYVU_RECHUNK_DATABASE_URL||'');
 if(!['127.0.0.1','localhost'].includes(url.hostname)&&process.env.NEYVU_RECHUNK_ALLOW_REMOTE!=='1')throw Error('Re-chunk is limited to a loopback database');
 const apply=process.argv.includes('--apply'),only=process.argv[process.argv.indexOf('--tenant')+1];
 const c=new Client({connectionString:url.href});await c.connect();
 const tx=async<T>(user:string,fn:()=>Promise<T>)=>{await c.query('BEGIN');await c.query("SELECT set_config('schoolvault.user_id',$1,true)",[user]);try{const v=await fn();await c.query('COMMIT');return v;}catch(e){await c.query('ROLLBACK');throw e;}};
 try{
  const users=(await c.query('SELECT id FROM schoolvault.users WHERE disabled_at IS NULL AND ($1::uuid IS NULL OR id=$1) ORDER BY id',[process.argv.includes('--tenant')?only:null])).rows;
  for(const {id:user} of users){
   const candidates=await tx(user,()=>rechunkCandidates(c,user));
   if(!apply){console.log(JSON.stringify({tenant:user.slice(0,8),candidates:candidates.length,dry_run:true}));continue;}
   for(const s of candidates)console.log(JSON.stringify({tenant:user.slice(0,8),...await tx(user,()=>rechunkSource(c as any,user,s.id))}));
  }
 }finally{await c.end();}
}
main().catch(e=>{console.error(e instanceof Error?e.message:'rechunk failed');process.exitCode=1;});
