import {createHash,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {tenant} from '../db';
import {BetaHttpError} from '../http';
import {sourceVersion} from '../vault';
import {createBetaFile} from '../files';
import {LmsError} from '../../../packages/connectors/src/read-only';
import type {LmsConnector,Course,DocumentRef} from '../../../packages/connectors/src/types';
import type {MailConnector} from '../../../packages/connectors/src/mail/mail';
import {accountTokens,lmsConnectorFor,mailConnectorFor} from './accounts';

// The sync job: read a connected account and write what it finds into the
// existing sources tables (courses, sources, source_versions, passages, tasks).
// A source gets a new immutable version only when the provider content hash
// changed. Neyvu never writes back to the platform.
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
const savedFileMimes=new Set(['application/pdf','text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.presentationml.presentation']);
export const htmlText=(html:string)=>html.replace(/<(script|style)[\s\S]*?<\/\1>/gi,' ').replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi,'\n').replace(/<[^>]+>/g,' ')
 .replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/[ \t]+/g,' ').replace(/\n\s*\n+/g,'\n\n').trim();

export type SyncCounts={courses:number;sources_new:number;sources_updated:number;unchanged:number;files_saved:number;files_skipped:number;tasks:number;events:number;groups:number;mail_kept:number;mail_discarded:number};
const zero=():SyncCounts=>({courses:0,sources_new:0,sources_updated:0,unchanged:0,files_saved:0,files_skipped:0,tasks:0,events:0,groups:0,mail_kept:0,mail_discarded:0});

async function item(c:PoolClient,user:string,account:string,ref:string){
 return (await c.query('SELECT * FROM schoolvault.connector_items WHERE user_id=$1 AND account_id=$2 AND external_ref=$3 FOR UPDATE',[user,account,ref])).rows[0];
}
async function putItem(c:PoolClient,user:string,account:string,ref:string,kind:string,f:{course_id?:string|null;source_id?:string|null;content_hash?:string|null;metadata?:object}){
 await c.query(`INSERT INTO schoolvault.connector_items(user_id,account_id,external_ref,item_kind,course_id,source_id,content_hash,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
  ON CONFLICT(user_id,account_id,external_ref) DO UPDATE SET course_id=coalesce(EXCLUDED.course_id,connector_items.course_id),source_id=coalesce(EXCLUDED.source_id,connector_items.source_id),content_hash=coalesce(EXCLUDED.content_hash,connector_items.content_hash),metadata=EXCLUDED.metadata,last_seen_at=now()`,
  [user,account,ref.slice(0,500),kind,f.course_id??null,f.source_id??null,f.content_hash??null,f.metadata||{}]);
}

async function ensureCourse(user:string,account:any,course:Course,counts:SyncCounts):Promise<string>{
 return tenant(user,async c=>{
  const known=await item(c,user,account.id,course.ref);
  if(known?.course_id){await putItem(c,user,account.id,course.ref,'course',{course_id:known.course_id,metadata:{code:course.code,title:course.title}});return known.course_id;}
  let id:string|undefined;
  // A Moodle token course is the same course the Companion may already have saved.
  if(account.kind==='moodle_token')id=(await c.query('SELECT id FROM schoolvault.courses WHERE user_id=$1 AND moodle_id=$2',[user,course.externalId])).rows[0]?.id;
  if(!id){
   id=randomUUID();
   await c.query('INSERT INTO schoolvault.courses(user_id,id,code,title,moodle_id,url) VALUES($1,$2,$3,$4,$5,$6)',[user,id,course.code.slice(0,40),course.title.slice(0,180),account.kind==='moodle_token'?course.externalId:null,course.provenance.sourceUrl]);
   counts.courses++;
  }
  await putItem(c,user,account.id,course.ref,'course',{course_id:id,metadata:{code:course.code,title:course.title}});
  return id;
 });
}

/** Upsert one text source for a provider item; new version only when its hash changed. */
async function textSource(user:string,account:any,ref:string,itemKind:string,courseId:string,f:{title:string;url:string;body:string;metadata?:object},counts:SyncCounts){
 const kind=account.kind==='moodle_token'?'moodle':(account.kind==='outlook'||account.kind==='gmail')?'email':'lms';
 const body=f.body.slice(0,200_000),hash=sha(body);
 return tenant(user,async c=>{
  const known=await item(c,user,account.id,ref);
  if(known?.source_id&&known.content_hash===hash){await putItem(c,user,account.id,ref,itemKind,{metadata:f.metadata});counts.unchanged++;return known.source_id;}
  let source=known?.source_id as string|undefined;
  if(!source)source=(await c.query('SELECT id FROM schoolvault.sources WHERE user_id=$1 AND course_id=$2 AND original_url=$3 AND kind=$4',[user,courseId,f.url,kind])).rows[0]?.id;
  if(!source){
   source=randomUUID();
   await c.query('INSERT INTO schoolvault.sources(user_id,id,course_id,kind,title,original_url) VALUES($1,$2,$3,$4,$5,$6)',[user,source,courseId,kind,f.title.slice(0,300),f.url]);
   counts.sources_new++;
  }else{await c.query('UPDATE schoolvault.sources SET title=$3 WHERE user_id=$1 AND id=$2',[user,source,f.title.slice(0,300)]);counts.sources_updated++;}
  await sourceVersion(c,user,source,body);
  await putItem(c,user,account.id,ref,itemKind,{course_id:courseId,source_id:source,content_hash:hash,metadata:f.metadata});
  return source;
 });
}

/** Save a binary original through the normal file path (quota, extraction job, page geometry). */
async function savedFile(user:string,account:any,ref:string,itemKind:'file'|'attachment',courseId:string,file:{filename:string;mime:string;bytes:Uint8Array;sha256:string;url:string;metadata?:object},counts:SyncCounts){
 const known=await tenant(user,c=>item(c,user,account.id,ref));
 if(known?.source_id&&known.content_hash===file.sha256){counts.unchanged++;return known.source_id as string;}
 if(!savedFileMimes.has(file.mime)||file.bytes.byteLength>10*1024*1024){counts.files_skipped++;await tenant(user,c=>putItem(c,user,account.id,ref,itemKind,{course_id:courseId,metadata:{...file.metadata,skipped:'unsupported type or over 10 MB',mime:file.mime}}));return null;}
 const result=await createBetaFile(user,courseId,file.filename,file.mime,Buffer.from(file.bytes),{prepare:async()=>({source_id:known?.source_id||undefined,original_url:file.url})});
 await tenant(user,c=>putItem(c,user,account.id,ref,itemKind,{course_id:courseId,source_id:result.id,content_hash:file.sha256,metadata:file.metadata}));
 counts.files_saved++;
 return result.id;
}

async function syncCourse(user:string,account:any,connector:LmsConnector,course:Course,counts:SyncCounts,issues:string[]){
 const courseId=await ensureCourse(user,account,course,counts);
 const docs=await connector.listDocuments(course.externalId);issues.push(...docs.issues);
 for(const doc of docs.items){
  try{
   if(doc.kind==='file'){
    if(!connector.fetchFile){counts.files_skipped++;continue;}
    const known=await tenant(user,c=>item(c,user,account.id,doc.ref));
    if(known&&known.metadata?.provider_hash===doc.provenance.contentHash){counts.unchanged++;continue;}
    const f=await connector.fetchFile(course.externalId,doc.externalId);
    await savedFile(user,account,doc.ref,'file',courseId,{...f,url:doc.provenance.sourceUrl,metadata:{provider_hash:doc.provenance.contentHash,title:doc.title}},counts);
    continue;
   }
   if(!doc.contentAvailable)continue;
   const content=await connector.getDocument(course.externalId,doc.externalId);
   const body=content.format==='html'?htmlText(content.content):content.content;
   if(!body.trim())continue;
   await textSource(user,account,doc.ref,'document',courseId,{title:doc.title,url:doc.provenance.sourceUrl,body,metadata:{kind:doc.kind,provider_hash:doc.provenance.contentHash}},counts);
  }catch(e){if(e instanceof LmsError&&(e.code==='reauthorize'||e.code==='identity_changed'))throw e;issues.push(`Could not read "${doc.title}" (${e instanceof LmsError?e.code:'error'}).`);}
 }
 const assignments=await connector.listAssignments(course.externalId);issues.push(...assignments.issues);
 for(const a of assignments.items){
  const body=[`Assignment: ${a.title}`,a.dueAt?`Due (exact, from the platform): ${a.dueAt}`:a.dueText?`Due as shown by the platform: ${a.dueText}`:'No due date given by the platform.','Submission and grade are not read by this connection.'].join('\n');
  const source=await textSource(user,account,a.ref+'#due','assignment',courseId,{title:`${a.title} (due date)`,url:a.provenance.sourceUrl+'#due-date',body,metadata:{due_at:a.dueAt,due_text:a.dueText}},counts);
  await tenant(user,async c=>{
   await c.query(`INSERT INTO schoolvault.tasks(user_id,id,course_id,source_id,external_id,evidence,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT(user_id,course_id,external_id) DO UPDATE SET evidence=EXCLUDED.evidence,observed_at=EXCLUDED.observed_at,source_id=EXCLUDED.source_id`,
    [user,randomUUID(),courseId,source,a.ref.slice(0,300),{title:a.title,due_at:a.dueAt,due_text:a.dueText,submission:'unverified',grade:'unverified',provenance:a.provenance,connector:account.kind},a.provenance.observedAt]);
  });
  counts.tasks++;
 }
 const lines:string[]=[];
 if(connector.listEvents){
  const events=await connector.listEvents(course.externalId);issues.push(...events.issues);
  for(const e of events.items){lines.push(`Event: ${e.title} — starts ${e.startAt}${e.endAt?`, ends ${e.endAt}`:''} (${e.eventType})`);counts.events++;await tenant(user,c=>putItem(c,user,account.id,e.ref,'event',{course_id:courseId,metadata:{title:e.title,start_at:e.startAt,end_at:e.endAt,type:e.eventType}}));}
 }
 if(connector.listGroups){
  const groups=await connector.listGroups(course.externalId);issues.push(...groups.issues);
  for(const g of groups.items){lines.push(`Your group in this course: ${g.name}`);counts.groups++;await tenant(user,c=>putItem(c,user,account.id,g.ref,'group',{course_id:courseId,metadata:{name:g.name}}));}
 }
 if(lines.length)await textSource(user,account,course.ref+'/calendar-and-groups','document',courseId,{title:`${course.code} calendar and groups`,url:course.provenance.sourceUrl,body:lines.join('\n'),metadata:{kind:'calendar'}},counts);
}

async function syncMail(user:string,account:any,connector:MailConnector,counts:SyncCounts,issues:string[],cursor:any){
 const senders=await tenant(user,async c=>(await c.query('SELECT address,course_id FROM schoolvault.connector_mail_senders WHERE user_id=$1 AND account_id=$2',[user,account.id])).rows);
 if(!senders.length){issues.push('No course senders are confirmed yet, so no mail was read.');return cursor;}
 const courseOf=new Map(senders.map(s=>[s.address,s.course_id]));
 const result=await connector.listMessagesFrom(senders.map(s=>s.address),cursor?.since||null);
 counts.mail_discarded+=result.discarded;issues.push(...result.issues);
 let newest=cursor?.since||null;
 for(const m of result.items){
  const courseId=courseOf.get(m.from.address);if(!courseId){counts.mail_discarded++;continue;}
  const body=[`From: ${m.from.name?`${m.from.name} <${m.from.address}>`:m.from.address}`,`Date: ${m.receivedAt}`,`Subject: ${m.subject}`,`Open in your mailbox: ${m.webLink}`,'',m.bodyText].join('\n');
  const ref=`${account.kind}:${m.externalId}`;
  await textSource(user,account,ref,'mail',courseId,{title:`${m.subject} — ${m.from.name||m.from.address}, ${m.receivedAt.slice(0,10)}`,url:m.webLink||`mailto:${m.from.address}`,body,metadata:{from:m.from.address,received_at:m.receivedAt,web_link:m.webLink,subject:m.subject}},counts);
  counts.mail_kept++;
  for(const a of m.attachments){
   try{const f=await connector.fetchAttachment(m.externalId,a);await savedFile(user,account,`${ref}/attachment:${a.id}`,'attachment',courseId,{...f,url:m.webLink,metadata:{from:m.from.address,received_at:m.receivedAt,message:m.externalId}},counts);}
   catch(e){issues.push(`Could not save attachment "${a.filename}" (${e instanceof LmsError?e.code:'error'}).`);}
  }
  if(!newest||m.receivedAt>newest)newest=m.receivedAt;
 }
 return {...cursor,since:newest};
}

export type SyncResult={run_id:string;status:'complete'|'partial'|'failed';counts:SyncCounts;issues:string[]};

/** One sync of one account. Safe to call from an API route or a scheduled job. */
export async function syncAccount(user:string,accountId:string):Promise<SyncResult>{
 const runId=randomUUID(),counts=zero(),issues:string[]=[];
 await tenant(user,async c=>{
  if(!(await c.query('SELECT 1 FROM schoolvault.connector_accounts WHERE user_id=$1 AND id=$2 AND revoked_at IS NULL',[user,accountId])).rowCount)throw new BetaHttpError('Connection not found.',404);
  await c.query("UPDATE schoolvault.connector_sync_runs SET status='failed',finished_at=now(),error='Abandoned' WHERE user_id=$1 AND account_id=$2 AND status='running' AND started_at<now()-interval '30 minutes'",[user,accountId]);
  try{await c.query('INSERT INTO schoolvault.connector_sync_runs(user_id,id,account_id) VALUES($1,$2,$3)',[user,runId,accountId]);}
  catch{throw new BetaHttpError('A sync for this connection is already running.',409);}
 });
 let status:SyncResult['status']='complete',error:string|null=null,accountStatus='connected',cursor:any;
 try{
  const loaded=await accountTokens(user,accountId),account=loaded.row;cursor=account.sync_cursor||{};
  if(account.kind==='outlook'||account.kind==='gmail')cursor=await syncMail(user,account,mailConnectorFor(loaded),counts,issues,cursor);
  else{
   const connector=lmsConnectorFor(loaded),courses=await connector.listCourses();issues.push(...courses.issues);
   for(const course of courses.items){
    try{await syncCourse(user,account,connector,course,counts,issues);}
    catch(e){if(e instanceof LmsError&&(e.code==='reauthorize'||e.code==='identity_changed'))throw e;issues.push(`Course ${course.code} could not be fully read (${e instanceof LmsError?e.code:'error'}).`);status='partial';}
   }
   if(!courses.complete)status='partial';
  }
 }catch(e){
  status='failed';
  if(e instanceof LmsError){error=e.code;accountStatus=e.code==='reauthorize'||e.code==='identity_changed'?'needs_reauth':'error';}
  else{error=e instanceof BetaHttpError?e.message.slice(0,200):'Sync failed';accountStatus='error';}
 }
 const unique=[...new Set(issues)].slice(0,50);
 await tenant(user,async c=>{
  await c.query('UPDATE schoolvault.connector_sync_runs SET status=$3,finished_at=now(),counts=$4,issues=$5,error=$6 WHERE user_id=$1 AND id=$2',[user,runId,status,counts,JSON.stringify(unique),error]);
  await c.query('UPDATE schoolvault.connector_accounts SET status=$3,last_error=$4,last_sync_at=CASE WHEN $5 THEN now() ELSE last_sync_at END,sync_cursor=coalesce($6,sync_cursor),updated_at=now() WHERE user_id=$1 AND id=$2 AND revoked_at IS NULL',
   [user,accountId,accountStatus,error,status!=='failed',cursor?JSON.stringify(cursor):null]);
 });
 return {run_id:runId,status,counts,issues:unique};
}

/** Scheduled job: sync every connected account of every active learner, one at a time. */
export async function syncAllAccounts(listUsers:()=>Promise<string[]>,listAccounts:(user:string)=>Promise<string[]>){
 const results:{user:string;account:string;status:string}[]=[];
 for(const user of await listUsers())for(const account of await listAccounts(user)){
  try{results.push({user,account,status:(await syncAccount(user,account)).status});}catch{results.push({user,account,status:'failed'});}
 }
 return results;
}
export type {DocumentRef};
