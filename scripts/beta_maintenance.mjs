// Explicit School operator action. Not run by builds, web requests or migrations.
import {open,lstat,unlink,access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import pg from 'pg';
const [action,id,...extra]=process.argv.slice(2);
if(extra.length||!['enter','status','leave'].includes(action))throw Error('Use enter, status, or leave <owned marker id>');
const expected={format:'neyvu-maintenance/1',version:'0.3.0',schema:41};
const root=process.env.SCHOOL_BETA_FILE_ROOT;
const local=process.env.SCHOOL_BETA_LOCAL==='1';
if(!root||!path.isAbsolute(root)||(!local&&root!=='/var/schoolvault/files'))throw Error('Exact School storage root required');
const parent=path.dirname(root),markerPath=path.join(parent,'.neyvu-maintenance.json');
if((await lstat(parent)).isSymbolicLink()||!(await lstat(parent)).isDirectory())throw Error('Unsafe School mount');
async function read(){
 let f;
 try{
  f=await open(markerPath,constants.O_RDONLY|constants.O_NOFOLLOW);const info=await f.stat();
  if(!info.isFile()||info.nlink!==1||info.size>1024||(info.mode&0o022)!==0)throw Error('Unsafe maintenance marker');
  const buffer=Buffer.alloc(1025),{bytesRead}=await f.read(buffer,0,buffer.length,0);
  if(bytesRead>1024)throw Error('Oversized maintenance marker');
  const m=JSON.parse(buffer.subarray(0,bytesRead).toString('utf8'));
  if(Object.keys(m).sort().join(',')!=='format,id,schema,version'||m.format!==expected.format||m.version!==expected.version||m.schema!==expected.schema
   ||typeof m.id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(m.id))throw Error('Unexpected maintenance marker');
  return m;
 }catch(error){if(error.code==='ENOENT')return null;throw error;}finally{await f?.close();}
}
if(action==='enter'){
 if(id)throw Error('enter generates its own marker id');
 const marker={...expected,id:randomUUID()},f=await open(markerPath,'wx',0o600);
 try{
  await f.writeFile(JSON.stringify(marker)+'\n');
  // The container's SSH operator starts as root; the web process runs as uid 1000.
  // Keep the marker private and readable by that exact School runtime identity.
  if(!local&&process.getuid?.()===0)await f.chown(1000,1000);
  await f.sync();
 }finally{await f.close();}
 console.log(JSON.stringify({maintenance:true,id:marker.id}));
}else if(action==='status'){
 if(id)throw Error('status takes no id');const marker=await read();console.log(JSON.stringify({maintenance:Boolean(marker),id:marker?.id||null}));
}else{
 const marker=await read();if(!marker||marker.id!==id)throw Error('Only the exact owned maintenance marker may be removed');
 const url=process.env.SCHOOL_BETA_DATABASE_URL;if(!url)throw Error('Restricted runtime readiness connection required');
 if(local){const target=new URL(url);if(target.hostname!=='127.0.0.1'||!target.pathname.startsWith('/schoolvault_cutover'))throw Error('Dedicated local cutover database required');}
 const client=new pg.Client({connectionString:url});await client.connect();
 try{
  const role=(await client.query('SELECT rolsuper,rolbypassrls,rolcreaterole FROM pg_roles WHERE rolname=current_user')).rows[0];
  if(!role||role.rolsuper||role.rolbypassrls||role.rolcreaterole)throw Error('Runtime role must remain restricted');
  const schema=(await client.query('SELECT count(*)::int AS count,max(version) AS latest FROM schoolvault.schema_migrations')).rows[0];
  if(schema.count!==expected.schema||schema.latest!==expected.schema)throw Error('Required School migrations are missing');
  const columns=(await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='schoolvault' AND table_name='users' AND column_name IN('last_answer_lease_at','last_extract_lease_at')")).rowCount;
  if(columns!==2)throw Error('School worker schema is missing');
  if(!(await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='schoolvault' AND table_name='chats' AND column_name='context_versions'")).rowCount)throw Error('School context schema is missing');
  await access(root,constants.R_OK|constants.W_OK);
 }finally{await client.end();}
 // Read again after the readiness check, refusing a marker changed by another operator.
 if((await read())?.id!==id)throw Error('Maintenance ownership changed');
 await unlink(markerPath);console.log(JSON.stringify({maintenance:false,released:true}));
}
