// Private operator workflow. Never import from an application route or page.
import {Client} from 'pg';
import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {open,lstat,realpath,readdir,mkdir,unlink} from 'node:fs/promises';
import path from 'node:path';
import {uuid} from './db';
import {assertRecoveryCoverage,deletionPlan,removeTenantRecords,removalTables,globalRecoveryRetention} from './recovery';

export type DeletionConfig={mode:'fixture'|'render';connectionString:string;runtimeConnectionString:string;fileRoot:string;buildId:string};
type ObjectRecord={key:string;bytes:number;sha256:string;registered:boolean};
export type AccountDeletionPlan={
 format:'neyvu-account-deletion/1';id:string;createdAt:string;accountId:string;requestReference:string;scope:'active-content-and-originals';
 target:string;buildId:string;schema:string;identity:string;disabledAt:string|null;records:string;counts:Record<string,number>;registeredBytes:number;
 objects:ObjectRecord[];retained:typeof globalRecoveryRetention;backupAndLogLimit:string;
};
type Intent={format:'neyvu-account-deletion-intent/1';plan:string;marker:string};
type State='database_committed'|'files_pending'|'complete';
type Event={format:'neyvu-account-deletion-event/1';sequence:number;plan:string;previous:string|null;at:string;state:State;remaining:string[]};
export type DeletionHooks={at?:(stage:'after_intent'|'before_commit'|'after_commit'|'before_unlink'|'after_unlink',key?:string)=>Promise<void>};
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const normalized=(value:any):any=>value instanceof Date?value.toISOString():Array.isArray(value)?value.map(normalized):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,normalized(value[key])])):value;
const canonical=(value:unknown)=>JSON.stringify(normalized(value));
const absent=(error:unknown)=>!!error&&typeof error==='object'&&'code' in error&&error.code==='ENOENT';
const backupLimit='Active-content removal does not erase identity/admission metadata, operational logs or recovery backups. Their remaining scope must be stated separately; no immediate all-copy erasure is claimed.';
function sameEndpoint(a:URL,b:URL){return a.protocol===b.protocol&&a.hostname===b.hostname&&(a.port||'5432')===(b.port||'5432')&&a.pathname===b.pathname;}
function validateConfig(config:DeletionConfig){
 const operator=new URL(config.connectionString),runtime=new URL(config.runtimeConnectionString);
 if(!['postgres:','postgresql:'].includes(operator.protocol)||!sameEndpoint(operator,runtime)||operator.username===runtime.username||! /^[a-f0-9]{64}$/.test(config.buildId)||!path.isAbsolute(config.fileRoot))throw Error('Invalid separate School operator configuration');
 if(config.mode==='fixture'){
  if(operator.hostname!=='127.0.0.1'||operator.port!=='55432'||!/^\/schoolvault_profiles_\d{8}t\d{6}z$/.test(operator.pathname)||operator.username!=='schoolvault_deletion_operator'||runtime.username!==operator.pathname.slice(1)+'_runtime')throw Error('Dedicated local operator fixture required');
 }else if(config.mode!=='render'||process.env.RENDER_SERVICE_ID!=='srv-REPLACE-WITH-SERVICE-ID'||['127.0.0.1','localhost'].includes(operator.hostname))throw Error('The commissioned School service is required');
 return operator;
}
async function checkedDirectory(directory:string,privateMode=false){
 if(!path.isAbsolute(directory))throw Error('An absolute directory is required');
 const stat=await lstat(directory),resolved=await realpath(directory);
 if(!stat.isDirectory()||stat.isSymbolicLink()||resolved!==path.resolve(directory)||privateMode&&(stat.mode&0o077)!==0)throw Error('Invalid private directory');
 return {directory:resolved,identity:hash(canonical({path:resolved,device:stat.dev,inode:stat.ino}))};
}
async function root(config:DeletionConfig){return checkedDirectory(config.fileRoot,true);}
async function target(config:DeletionConfig){
 const endpoint=validateConfig(config),storage=await root(config);
 return hash(canonical({mode:config.mode,host:endpoint.hostname,port:endpoint.port||'5432',database:endpoint.pathname,root:storage.identity}));
}
async function connect(config:DeletionConfig,accountId:string){
 validateConfig(config);if(!uuid(accountId)||accountId!==accountId.toLowerCase())throw Error('Canonical account ID required');
 const c=new Client({connectionString:config.connectionString,connectionTimeoutMillis:5000,statement_timeout:15000,application_name:'neyvu-account-deletion-operator'});c.on('error',()=>{});await c.connect();
 try{
  const role=(await c.query("SELECT rolsuper,rolbypassrls,pg_has_role(current_user,'schoolvault_web','MEMBER') AS web FROM pg_roles WHERE rolname=current_user")).rows[0];
  if(role.rolsuper||role.rolbypassrls||role.web)throw Error('A separate non-superuser, non-bypassRLS operator role is required');
  await c.query("SET TIME ZONE 'UTC'");
  // Session lock also excludes operator restore while file cleanup runs.
  await c.query("SELECT pg_advisory_lock(hashtextextended('schoolvault-account-lifecycle:'||lower($1),0))",[accountId]);return c;
 }catch(error){await c.end();throw error;}
}
async function begin(c:Client,user:string){await c.query('BEGIN');await c.query("SELECT set_config('schoolvault.user_id',$1,true)",[user]);}
async function schema(c:Client){return hash(canonical((await c.query('SELECT version,sha256 FROM schoolvault.schema_migrations ORDER BY version')).rows));}
async function identity(c:Client,user:string,locking=false){
 const row=(await c.query('SELECT id,email,google_sub,disabled_at FROM schoolvault.users WHERE id=$1'+(locking?' FOR UPDATE':''),[user])).rows[0];
 if(!row)throw Error('Account not found');
 return {identity:hash(canonical({id:row.id,email:row.email,subject:row.google_sub})),disabledAt:row.disabled_at?new Date(row.disabled_at).toISOString():null};
}
async function records(c:Client,user:string){
 const digest=createHash('sha256'),counts:Record<string,number>={};let bytes=0;
 for(const table of removalTables){
  counts[table]=0;digest.update(table+'\n');
  await c.query('DECLARE deletion_records NO SCROLL CURSOR FOR SELECT row_to_json(t) AS record FROM schoolvault.'+table+' t WHERE user_id='+ '$1 ORDER BY row_to_json(t)::text',[user]);
  try{for(;;){const batch=(await c.query('FETCH FORWARD 100 FROM deletion_records')).rows;if(!batch.length)break;
   for(const row of batch){const text=canonical(row.record);bytes+=Buffer.byteLength(text);if(bytes>64*1024*1024)throw Error('Account metadata exceeds the operator review limit');digest.update(text+'\n');counts[table]++;}
  }}finally{await c.query('CLOSE deletion_records');}
 }
 return {records:digest.digest('hex'),counts};
}
async function registeredObjects(c:Client,user:string){
 const rows=(await c.query('SELECT object_key::text AS key,bytes,sha256 FROM schoolvault.source_versions WHERE user_id=$1 AND object_key IS NOT NULL UNION ALL SELECT object_key::text AS key,bytes,sha256 FROM schoolvault.class_audio_chunks WHERE user_id=$1',[user])).rows;
 const result=new Map<string,{bytes:number;sha256:string}>();
 for(const row of rows){const item={bytes:Number(row.bytes),sha256:row.sha256};if(!uuid(row.key)||!Number.isSafeInteger(item.bytes)||item.bytes<1||! /^[a-f0-9]{64}$/.test(item.sha256))throw Error('Invalid registered original');
  if(result.has(row.key)&&canonical(result.get(row.key))!==canonical(item))throw Error('Conflicting original registry');result.set(row.key,item);}
 return result;
}
async function tenantDirectory(config:DeletionConfig,user:string){
 const storage=await root(config),directory=path.join(storage.directory,user);
 try{return (await checkedDirectory(directory,true)).directory;}catch(error){if(absent(error))return null;throw error;}
}
async function fileHash(file:string){
 const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const before=await handle.stat();if(!before.isFile()||before.size>256*1024*1024)throw Error('Invalid original object');
  const digest=createHash('sha256'),buffer=Buffer.alloc(64*1024);let bytes=0;
  for(;;){const read=await handle.read(buffer,0,buffer.length,null);if(!read.bytesRead)break;digest.update(buffer.subarray(0,read.bytesRead));bytes+=read.bytesRead;if(bytes>256*1024*1024)throw Error('Original exceeds review limit');}
  const after=await handle.stat();if(bytes!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw Error('Original changed during verification');
  return {bytes,sha256:digest.digest('hex'),device:before.dev,inode:before.ino};
 }finally{await handle.close();}
}
async function objects(config:DeletionConfig,user:string,registered:Map<string,{bytes:number;sha256:string}>){
 const directory=await tenantDirectory(config,user),result:ObjectRecord[]=[];
 for(const key of directory?(await readdir(directory)).sort():[]){
  if(!uuid(key)||key!==key.toLowerCase())throw Error('Unrecognized tenant-directory entry requires operator review');
  const observed=await fileHash(path.join(directory!,key)),expected=registered.get(key);
  if(expected&&(expected.bytes!==observed.bytes||expected.sha256!==observed.sha256))throw Error('Registered original failed verification');
  result.push({key,bytes:observed.bytes,sha256:observed.sha256,registered:!!expected});
 }
 if([...registered.keys()].some(key=>!result.some(item=>item.key===key)))throw Error('A registered original is missing');
 return result;
}
async function savePrivate(file:string,value:unknown){
 const handle=await open(file,'wx',0o600);try{await handle.writeFile(canonical(value)+'\n');await handle.sync();}finally{await handle.close();}
 const directory=await open(path.dirname(file),'r');try{await directory.sync();}finally{await directory.close();}
}
async function readPrivate(file:string){
 const stat=await lstat(file);if(stat.isSymbolicLink()||!stat.isFile()||(stat.mode&0o077)!==0||stat.size>4*1024*1024)throw Error('Invalid private journal file');
 const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);try{const bytes=await handle.readFile();if(bytes.length!==stat.size)throw Error('Journal changed during read');return {value:JSON.parse(bytes.toString('utf8')),digest:hash(bytes)};}finally{await handle.close();}
}
async function journalDirectory(config:DeletionConfig,directory:string){
 const resolved=(await checkedDirectory(directory,true)).directory,storage=(await root(config)).directory;
 if(resolved===storage||resolved.startsWith(storage+path.sep)||storage.startsWith(resolved+path.sep))throw Error('Operator journal must be separate from original storage');return resolved;
}
function validatePlan(plan:AccountDeletionPlan){
 if(Buffer.byteLength(canonical(plan))>=4*1024*1024)throw Error('Deletion plan exceeds the private journal review limit');
 if(plan?.format!=='neyvu-account-deletion/1'||!uuid(plan.id)||!uuid(plan.accountId)||plan.accountId!==plan.accountId.toLowerCase()||plan.scope!=='active-content-and-originals'||typeof plan.requestReference!=='string'||!plan.requestReference.trim()||plan.requestReference.length>200||/[\x00-\x1f]/.test(plan.requestReference)||!Number.isFinite(Date.parse(plan.createdAt))||!Array.isArray(plan.objects))throw Error('Invalid deletion plan');
 for(const key of ['target','buildId','schema','identity','records'] as const)if(! /^[a-f0-9]{64}$/.test(plan[key]))throw Error('Invalid deletion plan binding');
 if(canonical(Object.keys(plan.counts).sort())!==canonical([...removalTables].sort())||Object.values(plan.counts).some(n=>!Number.isSafeInteger(n)||n<0)||plan.counts.vaults!==1||!Number.isSafeInteger(plan.registeredBytes)||plan.registeredBytes<0)throw Error('Invalid deletion counts');
 const keys=new Set<string>();for(const item of plan.objects){if(!uuid(item.key)||item.key!==item.key.toLowerCase()||keys.has(item.key)||!Number.isSafeInteger(item.bytes)||item.bytes<0||! /^[a-f0-9]{64}$/.test(item.sha256)||typeof item.registered!=='boolean')throw Error('Invalid deletion object');keys.add(item.key);}
 if(canonical(plan.retained)!==canonical(globalRecoveryRetention)||plan.backupAndLogLimit!==backupLimit)throw Error('Retention scope changed');
}
export async function inspectAccountDeletion(config:DeletionConfig,directory:string){
 const {dir,plan,digest}=await readPlan(config,directory),chain=await events(dir,digest);
 let hasIntent=false;try{await readPrivate(path.join(dir,'intent.json'));hasIntent=true;}catch(error){if(!absent(error))throw error;}
 return {accountId:plan.accountId,planDigest:digest,scope:plan.scope,objects:plan.objects.length,registeredBytes:plan.registeredBytes,recordedState:chain.at(-1)?.event.state||(hasIntent?'reconciliation_required':'planned'),liveStateChecked:false,retained:plan.retained,backupAndLogLimit:plan.backupAndLogLimit};
}
async function readPlan(config:DeletionConfig,directory:string){
 const dir=await journalDirectory(config,directory),loaded=await readPrivate(path.join(dir,'plan.json')),plan=loaded.value as AccountDeletionPlan;validatePlan(plan);
 if(plan.target!==await target(config)||plan.buildId!==config.buildId)throw Error('Deletion plan belongs to another target or operator build');
 return {dir,plan,digest:loaded.digest};
}
async function events(directory:string,digest:string){
 const entries=(await readdir(directory)).sort(),result:Array<{event:Event;digest:string}>=[];
 for(const name of entries){
  if(['plan.json','intent.json'].includes(name))continue;
  if(!/^event-\d{6}\.json$/.test(name))throw Error('Unexpected operator journal entry');
  const loaded=await readPrivate(path.join(directory,name)),event=loaded.value as Event,previous=result.at(-1)?.digest||null;
  if(event.format!=='neyvu-account-deletion-event/1'||event.sequence!==result.length+1||event.plan!==digest||event.previous!==previous||!['database_committed','files_pending','complete'].includes(event.state)||!Array.isArray(event.remaining)||event.remaining.some(key=>!uuid(key)))throw Error('Invalid operator journal chain');
  result.push({event,digest:loaded.digest});
 }
 return result;
}
async function record(directory:string,digest:string,state:State,remaining:string[]){
 const chain=await events(directory,digest),sequence=chain.length+1;
 const event:Event={format:'neyvu-account-deletion-event/1',sequence,plan:digest,previous:chain.at(-1)?.digest||null,at:new Date().toISOString(),state,remaining};
 await savePrivate(path.join(directory,'event-'+String(sequence).padStart(6,'0')+'.json'),event);return event;
}
export async function planAccountDeletion(config:DeletionConfig,input:{accountId:string;requestReference:string;directory:string}){
 validateConfig(config);if(!uuid(input.accountId)||!input.requestReference.trim()||input.requestReference.length>200||/[\x00-\x1f]/.test(input.requestReference))throw Error('Exact account and holder-request reference required');
 const destination=path.resolve(input.directory);if(destination!==input.directory)throw Error('An absolute operation directory is required');
 const storage=(await root(config)).directory;if(destination===storage||destination.startsWith(storage+path.sep)||storage.startsWith(destination+path.sep))throw Error('Operator journal must be separate from original storage');
 await checkedDirectory(path.dirname(destination),true);
 const c=await connect(config,input.accountId);
 try{await begin(c,input.accountId);const base=await deletionPlan(c,input.accountId),who=await identity(c,input.accountId,true),registered=await registeredObjects(c,input.accountId),files=await objects(config,input.accountId,registered),rows=await records(c,input.accountId);
  const plan:AccountDeletionPlan={format:'neyvu-account-deletion/1',id:randomUUID(),createdAt:new Date().toISOString(),accountId:input.accountId,requestReference:input.requestReference,scope:'active-content-and-originals',target:await target(config),buildId:config.buildId,schema:await schema(c),...who,...rows,registeredBytes:base.bytes,objects:files,retained:globalRecoveryRetention,backupAndLogLimit:backupLimit};validatePlan(plan);
  await mkdir(destination,{mode:0o700});await journalDirectory(config,destination);await savePrivate(path.join(destination,'plan.json'),plan);await c.query('COMMIT');return plan;
 }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{await c.end();}
}
async function matchingCommitted(c:Client,plan:AccountDeletionPlan,intent:Intent){
 await assertRecoveryCoverage(c);if(await schema(c)!==plan.schema)throw Error('Schema changed after deletion planning');
 const who=await identity(c,plan.accountId),counts:Record<string,number>={};for(const table of removalTables)counts[table]=Number((await c.query('SELECT count(*) AS n FROM schoolvault.'+table+' WHERE user_id=$1',[plan.accountId])).rows[0].n);
 return who.identity===plan.identity&&who.disabledAt===intent.marker&&Object.values(counts).every(n=>n===0);
}
export async function applyAccountDeletion(config:DeletionConfig,input:{directory:string;confirmId:string;planDigest:string;resume?:boolean},hooks:DeletionHooks={}){
 const loaded=await readPlan(config,input.directory),{dir,plan,digest}=loaded;if(input.confirmId!==plan.accountId||input.planDigest!==digest)throw Error('Exact account and reviewed plan digest required');
 const c=await connect(config,plan.accountId);
 try{
  await events(dir,digest);
  const intentPath=path.join(dir,'intent.json');let intent:Intent;
  if(input.resume){intent=(await readPrivate(intentPath)).value;if(intent.format!=='neyvu-account-deletion-intent/1'||intent.plan!==digest||!Number.isFinite(Date.parse(intent.marker)))throw Error('Invalid deletion intent');}
  else{intent={format:'neyvu-account-deletion-intent/1',plan:digest,marker:new Date().toISOString()};await savePrivate(intentPath,intent);await hooks.at?.('after_intent');}
  await begin(c,plan.accountId);
  if(input.resume&&await matchingCommitted(c,plan,intent)){await c.query('COMMIT');}
  else{
   const base=await deletionPlan(c,plan.accountId),who=await identity(c,plan.accountId,true),rows=await records(c,plan.accountId),files=await objects(config,plan.accountId,await registeredObjects(c,plan.accountId));
   if(await target(config)!==plan.target||await schema(c)!==plan.schema||canonical(who)!==canonical({identity:plan.identity,disabledAt:plan.disabledAt})||rows.records!==plan.records||canonical(rows.counts)!==canonical(plan.counts)||base.bytes!==plan.registeredBytes||canonical(files)!==canonical(plan.objects))throw Error('Deletion plan is stale; no records were removed');
   await removeTenantRecords(c,plan.accountId,plan.accountId);
   // This exact timestamp is an atomic commit witness, including the budget release.
   await c.query('UPDATE schoolvault.users SET disabled_at=$2 WHERE id=$1',[plan.accountId,intent.marker]);await hooks.at?.('before_commit');await c.query('COMMIT');await hooks.at?.('after_commit');
  }
  if(!(await events(dir,digest)).some(item=>item.event.state==='database_committed'))await record(dir,digest,'database_committed',plan.objects.map(item=>item.key));
  const remaining=new Set(plan.objects.map(item=>item.key));
  try{
   for(const object of plan.objects){
    await c.query('SELECT 1'); // A failed lock-owning connection must stop filesystem work.
    if(await target(config)!==plan.target)throw Error('Original storage changed after review');
    const directory=await tenantDirectory(config,plan.accountId);if(!directory){remaining.delete(object.key);continue;}
    const file=path.join(directory,object.key);await hooks.at?.('before_unlink',object.key);
    try{const observed=await fileHash(file);if(observed.bytes!==object.bytes||observed.sha256!==object.sha256)throw Error('Original no longer matches the approved plan');
     const current=await lstat(file);if(current.isSymbolicLink()||current.dev!==observed.device||current.ino!==observed.inode)throw Error('Original identity changed before removal');
     await unlink(file);const folder=await open(directory,'r');try{await folder.sync();}finally{await folder.close();}
    }catch(error){if(!absent(error))throw error;}
    remaining.delete(object.key);await hooks.at?.('after_unlink',object.key);
   }
   const directory=await tenantDirectory(config,plan.accountId);if(directory&&(await readdir(directory)).length)throw Error('Unplanned files remain; operator review required');
   if(directory){const folder=await open(directory,'r');try{await folder.sync();}finally{await folder.close();}}
   await begin(c,plan.accountId);if(!await matchingCommitted(c,plan,intent))throw Error('Account changed during cleanup');await c.query('COMMIT');
   return await record(dir,digest,'complete',[]);
  }catch(error){await c.query('ROLLBACK').catch(()=>{});await record(dir,digest,'files_pending',[...remaining].sort());throw error;}
 }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{await c.end();}
}
