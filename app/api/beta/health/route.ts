import {betaRoute} from '../../../../lib/beta/api-route';
import {access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {betaPool} from '../../../../lib/beta/db';
import {release} from '../../../../lib/beta/release';
import {betaOrigin} from '../../../../lib/beta/config';
import {workerHealth} from '../../../../lib/beta/worker';
export const dynamic='force-dynamic';
async function handleGET(){
 const headers={'Cache-Control':'no-store'};
 if(!process.env.SCHOOL_BETA_DATABASE_URL){
  return Response.json({service:'SchoolVault',process:'running',storage:'unconfigured'},{status:process.env.SCHOOL_BETA_ENABLED==='1'?503:200,headers});
 }
 try{
  const row=(await betaPool().query('SELECT rolsuper,rolbypassrls,rolcreaterole FROM pg_roles WHERE rolname=current_user')).rows[0];
  if(!row||row.rolsuper||row.rolbypassrls||row.rolcreaterole)throw Error('Restricted database role required');
  if(!process.env.SCHOOL_BETA_FILE_ROOT)throw Error('File storage required');
  await access(process.env.SCHOOL_BETA_FILE_ROOT,constants.R_OK|constants.W_OK);
  const schema=await betaPool().query("SELECT column_name FROM information_schema.columns WHERE table_schema='schoolvault' AND table_name='users' AND column_name IN ('last_answer_lease_at','last_extract_lease_at')");
  if(schema.rowCount!==2)throw Error('School schema update required');
  if(!(await betaPool().query("SELECT column_name FROM information_schema.columns WHERE table_schema='schoolvault' AND table_name='chats' AND column_name='context_versions'")).rowCount)throw Error('School context schema update required');
  const applied=(await betaPool().query('SELECT count(*)::int AS count FROM schoolvault.schema_migrations WHERE version BETWEEN 1 AND $1',[release.schema])).rows[0];
  if(applied.count!==release.schema)throw Error('Required School migrations are missing');
  // Companions open the browser hand-off at this address, so a website move needs no Store release.
  let web_origin:string|undefined;try{web_origin=betaOrigin();}catch{}
  let worker:{state:string;heartbeat_age_seconds:number|null}|undefined;try{worker=await workerHealth();}catch{}
  return Response.json({service:'SchoolVault',process:'running',storage:'ready',release,web_origin,worker},{headers});
 }catch(error){
  const code=error&&typeof error==='object'&&'code' in error?String(error.code):'READINESS_FAILED';
  console.error('SchoolVault readiness:',/^[A-Z0-9_]+$/.test(code)?code:'READINESS_FAILED');
  return Response.json({service:'SchoolVault',process:'running',storage:'unavailable'},{status:503,headers});
 }
}

export const GET=betaRoute(handleGET);
