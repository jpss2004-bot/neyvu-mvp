// Private operator only. Never import this module from an app page/API.
import {Client} from 'pg';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,realpath,open,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {verifyAdminRecoveryRequest} from './admin-recovery-request';
export type AdminRecoveryConfig={mode:'fixture'|'render';connectionString:string;runtimeConnectionString:string;origin:string;accessKey:string;admins:string;recoveryRoot:string;buildId:string;migrations:{version:number;sha256:string}[]};
type Plan={format:'neyvu-admin-recovery-plan/1';id:string;target:string;buildId:string;schema:string;createdAt:string;expiresAt:string;email:string;request:string;requestReference:string};
type Intent={format:'neyvu-admin-recovery-intent/1';plan:string;tokenHash:string;expiresAt:string};
export type RecoveryHooks={at?:(stage:'before_insert'|'after_insert'|'after_commit')=>Promise<void>};
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const canonical=(value:unknown)=>JSON.stringify(value);
const hex=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function email(value:string){
 const normal=value.trim().toLowerCase();
 if(normal.length>254||!/^[-a-z0-9.!#$%&'*+/=?^_`{|}~]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(normal)||normal.includes('..'))throw Error('Invalid owner email');
 return normal;
}
function allowed(config:AdminRecoveryConfig,value:string){const normal=email(value);if(!config.admins.split(',').map(v=>v.trim().toLowerCase()).filter(Boolean).includes(normal))throw Error('Only a configured administrator can recover');return normal;}
function endpoint(config:AdminRecoveryConfig){
 const op=new URL(config.connectionString),runtime=new URL(config.runtimeConnectionString);
 if(!['postgres:','postgresql:'].includes(op.protocol)||!['postgres:','postgresql:'].includes(runtime.protocol)||op.hostname!==runtime.hostname||(op.port||'5432')!==(runtime.port||'5432')||op.pathname!==runtime.pathname||op.username===runtime.username||!hex(config.buildId)||!path.isAbsolute(config.recoveryRoot))throw Error('Separate School operator configuration required');
 if(config.mode==='fixture'){
  if(op.hostname!=='127.0.0.1'||op.port!=='55432'||!/^\/schoolvault_profiles_\d{8}t\d{6}z$/.test(op.pathname)||op.username!=='schoolvault_recovery_operator'||runtime.username!==op.pathname.slice(1)+'_runtime'||!/^http:\/\/(?:localhost|127\.0\.0\.1):(?:3228|3340|3342)$/.test(config.origin))throw Error('Dedicated fixture required');
 }else if(config.mode!=='render'||process.env.RENDER_SERVICE_ID!=='srv-REPLACE-WITH-SERVICE-ID'||['localhost','127.0.0.1'].includes(op.hostname)||!['https://neyvu-app.example.com','https://neyvu-web.example.com'].includes(config.origin)||path.resolve(config.recoveryRoot)!=='/var/schoolvault/ops/admin-recovery')throw Error('Exact School service and private recovery root required');
 return op;
}
async function directory(value:string){
 const stat=await lstat(value),resolved=await realpath(value);
 if(!stat.isDirectory()||stat.isSymbolicLink()||resolved!==path.resolve(value)||(stat.mode&0o077)!==0||stat.uid!==process.getuid?.())throw Error('Private owned directory required');
 return {path:resolved,device:stat.dev,inode:stat.ino};
}
async function location(config:AdminRecoveryConfig,value:string,create=false){
 endpoint(config);const root=await directory(config.recoveryRoot);
 if(path.dirname(value)!==root.path||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(path.basename(value)))throw Error('Choose a fresh directory inside the private recovery root');
 if(create)await mkdir(value,{mode:0o700});await directory(value);
 return sha(canonical({mode:config.mode,host:endpoint(config).hostname,port:endpoint(config).port||'5432',database:endpoint(config).pathname,operator:endpoint(config).username,runtime:new URL(config.runtimeConnectionString).username,origin:config.origin,root}));
}
async function readPrivate(file:string,max=16000){
 const f=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const st=await f.stat();if(!st.isFile()||st.nlink!==1||(st.mode&0o077)!==0||st.uid!==process.getuid?.()||st.size>max)throw Error('Unsafe private file');const bytes=await f.readFile();if(bytes.length>max)throw Error('Private file too large');return bytes.toString('utf8');}finally{await f.close();}
}
export async function readRecoveryOperatorInput(file:string,max:number){if(!path.isAbsolute(file)||await realpath(file)!==file)throw Error('Canonical private input file required');return (await readPrivate(file,max)).trim();}
async function writePrivate(file:string,value:string){const f=await open(file,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);try{await f.writeFile(value);await f.sync();}finally{await f.close();}}
async function connect(config:AdminRecoveryConfig){
 endpoint(config);const c=new Client({connectionString:config.connectionString,connectionTimeoutMillis:5000,statement_timeout:10000,application_name:'neyvu-admin-recovery-operator'});c.on('error',()=>{});await c.connect();
 try{
  const role=(await c.query("SELECT rolsuper,rolbypassrls,pg_has_role(current_user,'schoolvault_web','MEMBER') AS web,has_table_privilege(current_user,'schoolvault.admin_logins','SELECT') AS readable,has_table_privilege(current_user,'schoolvault.admin_logins','INSERT') AS insertable,has_table_privilege(current_user,'schoolvault.admin_logins','DELETE') AS deletable FROM pg_roles WHERE rolname=current_user")).rows[0];
  if(!role||role.rolsuper||role.rolbypassrls||role.web||!role.readable||!role.insertable||!role.deletable)throw Error('Separate restricted operator grants required');
  const schema=(await c.query('SELECT version,sha256 FROM schoolvault.schema_migrations ORDER BY version')).rows;
  if(canonical(schema)!==canonical(config.migrations))throw Error('Recovery artifact does not match the database migrations');
  return c;
 }catch(error){await c.end();throw error;}
}
const now=async(c:Client)=>(await c.query('SELECT clock_timestamp() AS now')).rows[0].now as Date;
async function readPlan(config:AdminRecoveryConfig,dir:string){
 const target=await location(config,dir),text=await readPrivate(path.join(dir,'plan.json')),plan=JSON.parse(text) as Plan;
 if(Object.keys(plan).sort().join()!=='buildId,createdAt,email,expiresAt,format,id,request,requestReference,schema,target'||plan.format!=='neyvu-admin-recovery-plan/1'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(plan.id)||plan.target!==target||plan.buildId!==config.buildId||plan.schema!==sha(canonical(config.migrations))||typeof plan.email!=='string'||allowed(config,plan.email)!==plan.email||typeof plan.request!=='string'||typeof plan.requestReference!=='string'||!plan.requestReference.trim()||plan.requestReference.length>1000||!Number.isFinite(Date.parse(plan.createdAt))||!Number.isFinite(Date.parse(plan.expiresAt))||Date.parse(plan.expiresAt)<=Date.parse(plan.createdAt)||Date.parse(plan.expiresAt)-Date.parse(plan.createdAt)>120000)throw Error('Invalid or mismatched private plan');
 return {plan,digest:sha(text)};
}
export async function planAdminRecovery(config:AdminRecoveryConfig,input:{directory:string;email:string;request:string;requestReference:string}){
 const targetEmail=allowed(config,input.email);endpoint(config);
 if(!input.requestReference.trim()||input.requestReference.length>1000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(input.requestReference))throw Error('A bounded current owner-request reference is required');
 const c=await connect(config);
 try{
  const at=await now(c),request=verifyAdminRecoveryRequest(input.request,config.accessKey,config.origin,at.getTime());
  const target=await location(config,input.directory,true);
  const plan:Plan={format:'neyvu-admin-recovery-plan/1',id:randomUUID(),target,buildId:config.buildId,schema:sha(canonical(config.migrations)),createdAt:at.toISOString(),expiresAt:new Date(Math.min(request.expiresAt,at.getTime()+120000)).toISOString(),email:targetEmail,request:input.request,requestReference:input.requestReference.trim()};
  await writePrivate(path.join(input.directory,'plan.json'),JSON.stringify(plan,null,2)+'\n');
  return inspectAdminRecovery(config,input.directory);
 }finally{await c.end();}
}
export async function applyAdminRecovery(config:AdminRecoveryConfig,input:{directory:string;confirmedEmail:string;planDigest:string},hooks:RecoveryHooks={}){
 const {plan,digest}=await readPlan(config,input.directory);
 if(input.confirmedEmail!==plan.email||input.planDigest!==digest)throw Error('Exact owner email and reviewed plan digest required');
 const c=await connect(config);let committed=false;
 try{
  await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='3s'");await c.query("SET LOCAL idle_in_transaction_session_timeout='5s'");
  // Normal email creation/consumption uses this same table. Keep the very short
  // issue transaction exclusive; never hold this lock during operator review.
  await c.query('LOCK TABLE schoolvault.admin_logins IN EXCLUSIVE MODE');
  const at=await now(c);if(Date.parse(plan.expiresAt)<=at.getTime()||Date.parse(plan.createdAt)>at.getTime()+30000)throw Error('Plan expired');
  const request=verifyAdminRecoveryRequest(plan.request,config.accessKey,config.origin,at.getTime());
  const token=randomBytes(32).toString('base64url'),expiresAt=new Date(Math.min(request.expiresAt,at.getTime()+300000)).toISOString();
  const intent:Intent={format:'neyvu-admin-recovery-intent/1',plan:digest,tokenHash:sha(token),expiresAt};
  // Exclusive intent prevents blind replay after an interrupted command. The
  // private link is not an issued credential until the DB transaction commits.
  await writePrivate(path.join(input.directory,'intent.json'),JSON.stringify(intent)+'\n');
  await writePrivate(path.join(input.directory,'sign-in-link.txt'),config.origin+'/beta/admin/confirm#'+token+'\n');
  await hooks.at?.('before_insert');
  await c.query('DELETE FROM schoolvault.admin_logins WHERE email=$1',[plan.email]);
  await c.query('INSERT INTO schoolvault.admin_logins(token_hash,email,browser_hash,expires_at) VALUES($1,$2,$3,$4)',[intent.tokenHash,plan.email,request.browserHash,expiresAt]);
  await hooks.at?.('after_insert');await c.query('COMMIT');committed=true;await hooks.at?.('after_commit');
  await writePrivate(path.join(input.directory,'receipt.json'),JSON.stringify({format:'neyvu-admin-recovery-receipt/1',plan:digest,tokenHash:intent.tokenHash,expiresAt,committedAt:(await now(c)).toISOString()})+'\n');
 }catch(error){if(!committed)await c.query('ROLLBACK').catch(()=>{});throw error;}finally{await c.end();}
 return inspectAdminRecovery(config,input.directory);
}
export async function inspectAdminRecovery(config:AdminRecoveryConfig,dir:string){
 const {plan,digest}=await readPlan(config,dir);const c=await connect(config);
 try{
  const at=await now(c),request=verifyAdminRecoveryRequest(plan.request,config.accessKey,config.origin,at.getTime(),true);
  let intent:Intent;try{intent=JSON.parse(await readPrivate(path.join(dir,'intent.json'),2000));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {email:plan.email,planSha256:digest,planExpiresAt:plan.expiresAt,state:Date.parse(plan.expiresAt)>at.getTime()?'prepared':'plan_expired',credentialReady:false};throw error;}
  if(Object.keys(intent).sort().join()!=='expiresAt,format,plan,tokenHash'||intent.format!=='neyvu-admin-recovery-intent/1'||intent.plan!==digest||!hex(intent.tokenHash)||!Number.isFinite(Date.parse(intent.expiresAt)))throw Error('Invalid intent; manual reconciliation required');
  const link=(await readPrivate(path.join(dir,'sign-in-link.txt'),1000)).trim(),prefix=config.origin+'/beta/admin/confirm#',token=link.startsWith(prefix)?link.slice(prefix.length):'';
  if(!/^[A-Za-z0-9_-]{43}$/.test(token)||sha(token)!==intent.tokenHash)throw Error('Private credential file does not match the intent');
  const row=(await c.query('SELECT email,browser_hash,expires_at,consumed_at FROM schoolvault.admin_logins WHERE token_hash=$1',[intent.tokenHash])).rows[0];
  if(row&&(row.email!==plan.email||row.browser_hash!==request.browserHash||new Date(row.expires_at).toISOString()!==intent.expiresAt))throw Error('Database credential binding differs; manual reconciliation required');
  const state=!row?'not_present_do_not_reissue':row.consumed_at?'consumed':Date.parse(intent.expiresAt)<=at.getTime()?'expired':'issued';
  return {email:plan.email,planSha256:digest,planExpiresAt:plan.expiresAt,state,credentialReady:state==='issued',credentialExpiresAt:intent.expiresAt,linkFile:path.join(dir,'sign-in-link.txt'),privateAuditDirectory:dir};
 }finally{await c.end();}
}
