import {retainedOriginal} from './retained_original';
import {importFileIO,ImportFileGap} from './import_file_io';
import {ownerForumParticipation} from '../lib/beta/owner-forum-participation';
import {ownerSnapshotStatus} from '../lib/beta/owner-snapshot-status';
/** Import a read-only owner vault copy into the isolated local SchoolVault tenant.
 * No collector, Notion API, remote database, or production status writer is used.
 */
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,chmod,realpath,lstat,stat,rename,unlink,statfs} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import type {PoolClient} from 'pg';
import {tenant,uuid,closeBetaPool} from '../lib/beta/db';
import {lockVault,checkObjects,checkHistory} from '../lib/beta/budget';

type LocalConfig={root:string;files:string;user:string;vault:string;snapshot:string;index:string;notes:string};
type ImportedItem={id:string;version_id?:string;sha256?:string;upstream_observed_at?:string|null;imported_body_sha256?:string;imported_note_sha256?:string;note_id?:string;original_path?:string;original_sha256?:string;original_bytes?:number};
type ImportMap={version:1;user_id:string;items:Record<string,ImportedItem>};
type SourceInput={key:string;course:string;title:string;kind:'file'|'moodle'|'note'|'ai_draft';url:string|null;body:string;observed:string|null;file?:string;fileSha?:string;mime?:string;bytes?:number;role?:string;classification?:string;originalPath?:string;verifiedPrivate?:boolean};
const digest=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
export function retainNativeWordExtraction(current:{source_id:string;current_version:string;sha256:string;body:string},incoming:{sha256:string;mime?:string},receipt:{status?:string;result?:any}|undefined){
 const r=receipt?.result;
 return incoming.mime===mimeFor['.docx']&&current.sha256===incoming.sha256&&receipt?.status==='complete'
  &&r?.format==='docx'&&r.source_id===current.source_id&&r.version_id===current.current_version
  &&r.original_sha256===incoming.sha256&&r.text_sha256===digest(current.body);
}
const inside=(root:string,candidate:string)=>candidate!==root&&!path.relative(root,candidate).startsWith('..'+path.sep)&&!path.isAbsolute(path.relative(root,candidate));
const date=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
const dateOnly=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
const title=(v:unknown,fallback='Imported source')=>String(v||fallback).replace(/[\x00-\x1f]/g,' ').trim().slice(0,180)||fallback;
const mimeFor:Record<string,string>={'.html':'text/html','.htm':'text/html','.srt':'text/plain','.md':'text/markdown','.txt':'text/plain','.pdf':'application/pdf','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.mp4':'video/mp4'};
// Positive provenance from a local-owner audit. These are exact artifact
// hashes, not title/filename rules. The public snapshot carries synthetic
// placeholder hashes; a deployment lists the hashes of its own reviewed
// AI-made artifacts. A changed artifact requires a new provenance review.
const reviewedAIArtifacts=new Set([
 '2aeaaab2a84b5783fb21f3a6c2c1c9aa68ccbd72cdbece3bdef27c26cce67d89',
 '75ee3602fa0d11b091bec560a86035222cfc877e0d844de391abd426b516fb44',
]);
export function classifyImportedDocument(doc:{source_role?:unknown;role?:unknown;origin?:unknown;sha256?:unknown}|undefined,sha:string){
 const role=String(doc?.source_role||doc?.role||''),origin=String(doc?.origin||''),valid=doc?.sha256===sha;
 if(valid&&['moodle_original_file','moodle_activity_capture','reviewed_source_copy'].includes(role))return {ai:false,verified_original:true,classification:'hash-matching original-source role: '+role,unknown_authorship:false};
 if(valid&&(['ai_draft','assistant_draft','ai_study_draft','generated_study_material'].includes(role)||['ai_draft','assistant_draft','ai_generated','ai_study_draft'].includes(origin)||role==='prior_work'&&['generated','ai_generated','assistant_draft'].includes(origin)))return {ai:true,verified_original:false,classification:'hash-matching explicit AI provenance metadata',unknown_authorship:false};
 if(valid&&reviewedAIArtifacts.has(sha))return {ai:true,verified_original:false,classification:'exact-hash AI artifact provenance reviewed 2026-10-03',unknown_authorship:false};
 return {ai:false,verified_original:false,classification:valid&&role==='working_material'?'personal working material; AI authorship is not established':'authorship not established by hash-matching source metadata',unknown_authorship:true};
}

export function deterministicId(user:string,key:string){
 const b=createHash('sha256').update('schoolvault-personal-local-v1\0'+user+'\0'+key).digest().subarray(0,16);b[6]=(b[6]&15)|0x50;b[8]=(b[8]&63)|0x80;
 const hex=b.toString('hex');return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
}
export function validateLocalConfig(env:Record<string,string|undefined>):LocalConfig{
 if(env.SCHOOL_BETA_LOCAL!=='1'||env.SCHOOL_BETA_ORIGIN!=='http://localhost:3228')throw Error('Import requires the isolated local SchoolVault origin.');
 let db:URL;try{db=new URL(env.SCHOOL_BETA_DATABASE_URL||'');}catch{throw Error('Local database is not configured.');}
 if(!['postgres:','postgresql:'].includes(db.protocol)||db.username!=='schoolvault_local_runtime'||!['localhost','127.0.0.1','[::1]'].includes(db.hostname)||db.port!=='55433'||db.pathname!=='/schoolvault_local'||db.hash||[...db.searchParams.keys()].some(k=>!['sslmode','application_name'].includes(k))||db.searchParams.get('sslmode')&&!['disable','prefer','require'].includes(db.searchParams.get('sslmode')!))throw Error('Import accepts only schoolvault_local_runtime at loopback port 55433 / schoolvault_local.');
 if(!uuid(env.SCHOOL_LOCAL_USER_ID))throw Error('Local owner account is not configured.');
 const root=env.SCHOOL_LOCAL_ROOT||'',files=env.SCHOOL_BETA_FILE_ROOT||'';
 if(!path.isAbsolute(root)||!path.isAbsolute(files)||!inside(path.resolve(root),path.resolve(files)))throw Error('Originals must use a private directory under SCHOOL_LOCAL_ROOT.');
 const vault=env.SCHOOL_PERSONAL_VAULT_ROOT||path.join(os.homedir(),'school-vault');
 if(path.resolve(root)===path.resolve(vault)||inside(path.resolve(vault),path.resolve(root))||path.resolve(root)===path.resolve(os.homedir())||['Desktop','Documents'].some(folder=>path.resolve(root)===path.resolve(os.homedir(),folder)||inside(path.resolve(os.homedir(),folder),path.resolve(root))))throw Error('Local import storage must be private and outside the owner vault and synced Desktop/Documents.');
 const state=env.SCHOOL_LOCAL_STATE_DIR||path.join(os.homedir(),'.schoolvault');
 return {root:path.resolve(root),files:path.resolve(files),user:env.SCHOOL_LOCAL_USER_ID,vault:path.resolve(vault),snapshot:env.SCHOOL_PERSONAL_SNAPSHOT_PATH||path.join(state,'state/snapshot.json'),index:env.SCHOOL_PERSONAL_INDEX_PATH||path.join(state,'mini-materials/knowledge_index.json'),notes:env.SCHOOL_PERSONAL_NOTES_DB||path.join(os.homedir(),'Library/Application Support/School Pilot/pilot.sqlite')};
}
export function noteRefreshDecision(currentBody:string,previousImportedHash:string|undefined,incomingBody:string){
 const current=digest(currentBody),incoming=digest(incomingBody);
 if(current===incoming)return 'unchanged';
 return previousImportedHash&&current===previousImportedHash?'refresh':'preserve_local_edit';
}
export function normalizeImportedText(body:string){return {body:body.replace(/\0/g,'\uFFFD'),replaced_nuls:(body.match(/\0/g)||[]).length};}
export function clipImportedText(body:string,limit=80_000){return {body:normalizeImportedText(body).body.slice(0,limit),clipped:body.length>limit,original_characters:body.length};}
export function aiOriginalNotebookBody(source:{id:string;version:string;title:string;body:string;observed:string|null}){
 return clipImportedText('AI-written study material. Review the mathematics and reasoning against the original course sources; this is not instructor material.\n\nOriginal file: '+source.title+'\nOriginal download: http://localhost:3228/api/beta/files?id='+source.id+'&version='+source.version+'\nOriginal observation: '+(source.observed||'Unknown')+'\n\n'+(source.body.trim()?source.body:'The original is retained, but no hash-matching searchable text was saved. Open the original to review it.')).body;
}
export function personalOriginalNotebookBody(source:{id:string;version:string;title:string;body:string;observed:string|null}){
 return clipImportedText('Personal course reference. Authorship has not been established, and this is not verified instructor material. Compare it with the original course sources.\n\nOriginal file: '+source.title+'\nOriginal download: http://localhost:3228/api/beta/files?id='+source.id+'&version='+source.version+'\nOriginal observation: '+(source.observed||'Unknown')+'\n\n'+(source.body.trim()?source.body:'The original is retained, but no hash-matching searchable text was saved. Open the original to review it.')).body;
}
export function savedMoodleTaskRecord(task:{title?:unknown;url?:unknown;due?:unknown;observed_at?:unknown;submission_status?:unknown;grading_status?:unknown}){
 return ['Saved Moodle task record imported from the checksum-verified owner snapshot.',
 'Scope: explicit task fields only. The complete activity page was not captured by this import; refresh Moodle to check current requirements.',
 'Activity: '+String(task.title||'Untitled activity'),'Exact activity URL: '+String(task.url||''),'Explicit saved due field: '+String(task.due||'Not recorded'),
 'Original observation: '+String(task.observed_at||'Unknown'),
 ...(task.submission_status?['Saved visible submission-status field: '+String(task.submission_status)]:[]),
 ...(task.grading_status?['Saved visible grading-status field: '+String(task.grading_status)]:[]),
 'A deadline, working status, or grade alone never establishes a submission. These are dated observations, not a current Moodle connection.'].join('\n');
}
export function generatedIndexedOutput(relative:string){
 // Exact output location owned by Sync/course_calendar.py; similarly named
 // readings, syllabi and personal plans remain eligible source material.
 return /^Courses\/[^/]+\/Study\/Course calendar\.md$/.test(relative);
}
export function eligibleIndexedDocument(relative:string){
 return /^Courses\/[^/]+\/(?:Study|Assignments|Moodle\/(?:Files|Source pages))\//.test(relative)
  && !generatedIndexedOutput(relative)
  && !/\/(?:History|Task briefs)\/|(?:Session context|Verified source review|README)\.md$/.test(relative);
}
export function snapshotCourseSources(records:any[],codes:string[]):SourceInput[]{
 const allowed=new Set(codes),chosen=new Map<string,SourceInput>();
 for(const r of records){
  const receipt=r.source_id==='moodle'&&r.authority==='Moodle'&&r.kind==='receipt';
  const moodle=r.source_id==='moodle'&&r.authority==='Moodle'&&(r.kind==='note'||receipt);
  const email=r.source_id==='gmail'&&r.kind==='message';
  const stored=receipt?JSON.stringify(Object.fromEntries(['id','title','receipt_type','submission_status','grading_status','grade_display','grade_percentage','grade_state','feedback','status','notes'].filter(k=>r[k]!==undefined&&r[k]!==null).map(k=>[k,r[k]])),null,2):r.notes;
  if(!moodle&&!email||r.deleted||typeof stored!=='string'||!stored.trim()||!date(r.observed_at))continue;
  let url:URL;try{url=new URL(r.url);}catch{continue;}
  if(url.protocol!=='https:'||url.username||url.password||moodle&&url.hostname!=='moodle.acadiau.ca'||email&&url.hostname!=='mail.google.com')continue;
  const scopes=[...new Set([r.course,...(Array.isArray(r.courses)?r.courses:[])].filter(v=>typeof v==='string'&&allowed.has(v)))] as string[];
  for(const course of scopes){
   const key=receipt?'moodle-receipt:'+course+':'+String(r.id):moodle?'moodle:'+course+':'+url.href:'course-email:'+course+':'+String(r.id);
   const candidate:SourceInput={key,course,title:title(r.title),kind:moodle&&!receipt?'moodle':'file',url:url.href,
    body:(email?'Saved email fields (not a Moodle receipt):\n'+['from','to','subject'].filter(k=>r[k]!=null).map(k=>k+': '+String(r[k])).join('\n')+'\n\n':'')+stored,
    observed:date(r.observed_at),role:receipt?'moodle_receipt_observation':moodle?'moodle_observation':'course_email',classification:'checksum-verified owner snapshot; stored record text, not a new live check'};
   const old=chosen.get(key);if(!old||candidate.observed!>old.observed!)chosen.set(key,candidate);
  }
 }
 return [...chosen.values()];
}
export function mergeObservedSources(existing:SourceInput[],observations:SourceInput[]){
 const result=new Map(existing.map(s=>[s.key,s]));
 for(const s of observations){const old=result.get(s.key);if(!old||s.observed&&(!old.observed||s.observed>old.observed))result.set(s.key,s);}
 return [...result.values()];
}
export function mergeSnapshotNotebooks(existing:any[],records:any[]){
 const result=[...existing],identity=(v:unknown)=>String(v||'').replace(/-/g,'').match(/[a-f0-9]{32}/i)?.[0].toLowerCase();
 for(const r of records){
  if(r.source_id!=='notion_notes'||r.kind!=='note'||r.deleted||typeof r.notes!=='string'||!r.notes.trim()||!r.course)continue;
  const id=identity(r.id);if(!id)continue;
  const at=date(r.source_modified_at)||date(r.observed_at),n=result.findIndex(v=>identity(v.key)===id||identity(v.url)===id),old=result[n];
  if(old&&old.updated&&at&&old.updated>=at)continue;
  const next={key:old?.key||'notebook:'+r.id,course:r.course,title:title(r.title),body:r.notes,transcript:'',summary:'',kind:old?.kind==='ai_draft'?'ai_draft':'note',url:r.url||null,created:old?.created||at,updated:at,origin:old?.kind==='ai_draft'?'ai_draft':'imported_personal_notebook'};
  if(n<0)result.push(next);else result[n]=next;
 }
 return result;
}

export async function reviewedNoClassDates(holidays:unknown,verify:(source:any)=>Promise<boolean>){
 const dates:string[]=[],retained:any[]=[],issues:{key:string;reason:string}[]=[];
 if(!Array.isArray(holidays)||!holidays.length)return {complete:false,dates,retained,issues:[{key:'holidays',reason:'No reviewed no-class date collection is available; previous timetable retained.'}]};
 for(const holiday of holidays){
  if(!holiday||typeof holiday!=='object'){issues.push({key:'holidays',reason:'No-class date entry is malformed; previous timetable retained.'});continue;}
  const value=String(holiday.date||'');
  if(!dateOnly(value)){issues.push({key:'holiday:'+value,reason:'Reviewed no-class date is malformed; previous timetable retained.'});continue;}
  const sources=Array.isArray(holiday.sources)?holiday.sources:[],valid=await Promise.all(sources.map(verify));
  if(!valid.length||valid.some(v=>!v)){issues.push({key:'holiday:'+value,reason:'Reviewed no-class date source hash is missing or changed; previous timetable retained.'});continue;}
  dates.push(value);retained.push(holiday);
 }
 return {complete:issues.length===0,dates:[...new Set(dates)],retained,issues};
}

export function parseCsv(body:string):Record<string,string>[] {
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
 for(let n=0;n<body.length;n++){const ch=body[n];if(ch==='"'){if(quoted&&body[n+1]==='"'){cell+='"';n++;}else quoted=!quoted;}
 else if(ch===','&&!quoted){row.push(cell);cell='';}else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&body[n+1]==='\n')n++;row.push(cell);if(row.some(Boolean))rows.push(row);row=[];cell='';}else cell+=ch;}
 if(quoted)throw Error('Source register CSV has an incomplete quoted field.');if(cell||row.length){row.push(cell);rows.push(row);}
 const headers=rows.shift()||[];return rows.map(row=>Object.fromEntries(headers.map((h,n)=>[h,row[n]||''])));
}
async function privateDirectory(folder:string){await mkdir(folder,{recursive:true,mode:0o700});if((await lstat(folder)).isSymbolicLink()||(await realpath(folder))!==folder)throw Error('Private import directory cannot be a symlink.');await chmod(folder,0o700);}
async function privateJson(file:string,data:unknown){const temp=file+'.pending-'+process.pid;await writeFile(temp,JSON.stringify(data,null,2)+'\n',{mode:0o600,flag:'wx'});await chmod(temp,0o600);await rename(temp,file);await chmod(file,0o600);}
function planningReference(row:any){return [
 'Imported personal planning reference. These are the student’s saved planning fields; they do not establish an official deadline, Moodle receipt, or grade.',
 'Title: '+String(row.title||''),'Working status: '+String(row.status||'Not recorded'),'Personal Do on: '+String(row.do_on||'Not recorded'),
 'Personal planned date: '+String(row.due||'Not recorded'),'Exact linked official activity: '+String(row.official_url||'Not recorded'),
 'Source observed at: '+String(row.observed_at||'Not recorded'),String(row.notes||'')].join('\n');}

export async function importPersonalLocal(env=process.env){
 const cfg=validateLocalConfig(env);cfg.vault=await realpath(cfg.vault);const statusOnly=env.SCHOOL_PERSONAL_IMPORT_STATUS_ONLY==='1';
 const io=importFileIO({fileMs:2000,budgetMs:180000});let retentionIO:ReturnType<typeof importFileIO>|undefined;const reuseCandidates=new Map<string,ReturnType<typeof retainedOriginal>>(),reused:{path:string;sha256:string;source_id:string;version_id:string}[]=[];
 const material=async(relative:string,text=false)=>{const cached=reuseCandidates.get(relative);if(cached){try{const checked=await io.run({root:cfg.files,relative:path.join(cfg.user,cached.object_key),text});if(checked.sha256!==cached.sha256)throw Error('A retained original failed its expected checksum; previous data was preserved.');reused.push({path:relative,sha256:checked.sha256,source_id:cached.source_id,version_id:cached.version_id});return {...checked,originalPath:relative,verifiedPrivate:true};}catch(e){if(!(e instanceof ImportFileGap))throw e;const gap=io.gaps.at(-1);if(gap)gap.path=relative;}}
  try{return {...await io.run({root:cfg.vault,relative,text}),originalPath:relative,verifiedPrivate:false};}catch(e){if(e instanceof ImportFileGap)return null;throw e;}};
 const started=new Date().toISOString(),warnings:{key:string;reason:string}[]=[];
 const counts={courses:0,notes:0,sources:0,files:0,sources_added:0,sources_reclassified:0,versions_added:0,sources_unchanged:0,notes_added:0,notes_refreshed:0,notes_unchanged:0,local_note_edits_preserved:0,tasks:0,meetings:0,originals_copied:0,originals_bytes:0,skipped:0};
 await privateDirectory(cfg.root);await privateDirectory(cfg.files);const ownerFiles=path.join(cfg.files,cfg.user);await privateDirectory(ownerFiles);
 // The local runtime owns import.lock and import-status.json for both UI and CLI.
 // Invoke this importer through that runtime so one import runs at a time.
 const mapFile=path.join(cfg.root,'personal-import-map.json');let map:ImportMap={version:1,user_id:cfg.user,items:{}};
 const copied:string[]=[];
 try{
  try{map=JSON.parse(await readFile(mapFile,'utf8'));if(map.version!==1||map.user_id!==cfg.user||!map.items)throw Error('Local import map belongs to another account.');}catch(e:any){if(e.code!=='ENOENT')throw e;}
  const snapshotBytes=await readFile(cfg.snapshot),snapshotHash=(await readFile(path.join(path.dirname(cfg.snapshot),'snapshot.sha256'),'utf8')).trim();if(digest(snapshotBytes)!==snapshotHash)throw Error('Replicated owner snapshot checksum does not match.');
  const snapshot=JSON.parse(snapshotBytes.toString('utf8')),indexBytes=await readFile(cfg.index),index=JSON.parse(indexBytes.toString('utf8'));
  if(!Array.isArray(snapshot.records)||!date(snapshot.generated_at)||!Array.isArray(index.documents)||!Array.isArray(index.chunks)||!date(index.built_at))throw Error('Owner snapshot or index is invalid.');
  if(Date.now()-Date.parse(snapshot.generated_at)>6*3600_000)warnings.push({key:'snapshot',reason:'Owner snapshot is older than six hours; imported observations keep their original dates.'});
  const control=await io.run({root:cfg.vault,relative:'Sync/course_source_register.csv',text:true,control:true});const registerBytes=Buffer.from(control.text||''),register=statusOnly?[]:parseCsv(registerBytes.toString('utf8'));if(control.bytes>8*1024**2)throw Error('Course register exceeds bounded control-text limit.');
  const courseControl=await io.run({root:cfg.vault,relative:'Sync/courses.json',text:true,control:true});const courses:any[]=JSON.parse(courseControl.text||'');
  let timetable:any={};if(!statusOnly){const calendar=await material('Sync/calendar_schedule.json',true);if(calendar)try{timetable=JSON.parse(calendar.text||'{}');}catch{warnings.push({key:'Sync/calendar_schedule.json',reason:'Calendar control text is incomplete or invalid; previous meetings retained.'});}}
  const byPath=new Map<string,any>();for(const d of index.documents)for(const p of [d.path,...(d.aliases||[])])byPath.set(p,d);
  if(!statusOnly){const entries=Object.values(map.items).filter(e=>e.original_path&&e.version_id),versions=await tenant(cfg.user,async c=>(await c.query('SELECT id,source_id,sha256,object_key,bytes FROM schoolvault.source_versions WHERE user_id=$1 AND id=ANY($2::uuid[])',[cfg.user,entries.map(e=>e.version_id)])).rows),byVersion=new Map(versions.map(v=>[v.id,v]));for(const e of entries){const rel=e.original_path!,expected=byPath.get(rel)?.sha256;const candidate=retainedOriginal(e,byVersion.get(e.version_id),rel,expected);if(candidate)reuseCandidates.set(rel,candidate);}}
  const chunks=new Map<string,any[]>();for(const chunk of index.chunks){if(!chunks.has(chunk.doc))chunks.set(chunk.doc,[]);chunks.get(chunk.doc)!.push(chunk);}
  for(const list of chunks.values())list.sort((a,b)=>(a.offset_words||0)-(b.offset_words||0));
  let sources:SourceInput[]=[];const knownPaths=new Set<string>(),knownKeys=new Set<string>();
  const extraction=(relative:string,sha:string)=>{const doc=byPath.get(relative);return doc?.sha256===sha?(chunks.get(doc.id)||[]).map(c=>String(c.text||'')).join('\n\n'):'';};
  for(const r of register.sort((a,b)=>(b.retrieved_at_utc||'').localeCompare(a.retrieved_at_utc||''))){
   const suffix=path.extname(r.local_path).toLowerCase(),mime=mimeFor[suffix];if(!mime){warnings.push({key:r.local_path,reason:'Unsupported original type.'});counts.skipped++;continue;}
   const checked=await material(r.local_path,['.md','.txt'].includes(suffix));if(!checked){counts.skipped++;continue;}const file=checked.path,bytes=checked.bytes;if(!bytes){warnings.push({key:r.local_path,reason:'Original is empty.'});counts.skipped++;continue;}
   const sha=checked.sha256,textual=['.md','.txt'].includes(suffix),doc=byPath.get(r.local_path),classification=classifyImportedDocument(doc,sha),kind=classification.ai?'ai_draft':textual&&r.source_url.startsWith('https://moodle.acadiau.ca/')?'moodle':'file';
   const key=kind==='moodle'?'moodle:'+r.course+':'+r.source_url:'file:'+r.course+':'+r.local_path;
   if(knownKeys.has(key))continue;knownKeys.add(key);knownPaths.add(r.local_path);
   let body=textual?checked.text||'':extraction(r.local_path,sha);
   if(textual&&bytes>Buffer.byteLength(body))warnings.push({key:r.local_path,reason:'Searchable text is bounded to 80,000 characters; original bytes and hash are retained.'});
   if(!textual&&!body)warnings.push({key:r.local_path,reason:'Original retained; no hash-matching cached searchable text exists.'});
   if(r.reviewed_sha256&&r.reviewed_sha256!==sha)warnings.push({key:r.local_path,reason:'Original differs from the previously reviewed hash; prior review is not treated as current.'});
   sources.push({key,course:r.course,title:title(r.title,path.basename(r.local_path)),kind,url:r.source_url||null,body,observed:date(r.retrieved_at_utc),file,originalPath:checked.originalPath,verifiedPrivate:checked.verifiedPrivate,fileSha:sha,mime,bytes,role:doc?.source_role||doc?.role,classification:classification.classification});
  }
  // Hand-written Study and Assignments material, including AI work, stays distinct
  // from official Moodle content. Generated session/brief/report views are omitted.
  const historical=(p:unknown)=>/\/(?:Before|History|Archive|diff_pages|Build)\//i.test(String(p));
  const generatedOutputs=statusOnly?[]:index.documents.filter((d:any)=>generatedIndexedOutput(String(d.path||''))).map((d:any)=>({path:d.path,reason:'Generated calendar summary; original course evidence is imported separately.'}));
  const documents=statusOnly?[]:[...index.documents].sort((a,b)=>Number(historical(a.path))-Number(historical(b.path)));
  for(const doc of documents){
   const rel=String(doc.path||'');if([rel,...(doc.aliases||[])].some(p=>knownPaths.has(p))||!eligibleIndexedDocument(rel))continue;
   const suffix=path.extname(rel).toLowerCase();if(!mimeFor[suffix])continue;const checked=await material(rel,['.md','.txt','.srt'].includes(suffix));if(!checked){counts.skipped++;continue;}const file=checked.path,bytes=checked.bytes,sha=checked.sha256;if(!bytes)continue;if(sha!==doc.sha256){counts.skipped++;io.gaps.push({path:rel,operation:'inspect',reason:'index_hash_changed'});warnings.push({key:rel,reason:'Hand-written material changed since the replicated index; cached text skipped.'});continue;}
   const classification=classifyImportedDocument(doc,sha),key='local:'+doc.course+':'+rel;
   if(classification.unknown_authorship)warnings.push({key:rel,reason:'Index marks personal working material but does not establish AI or instructor authorship; retained as labelled personal material.'});
   if(/\/(?:tmp|__pycache__)\//.test(rel)&&!map.items[key]){warnings.push({key:rel,reason:'Temporary builder output omitted from new personal imports.'});counts.skipped++;continue;}
   const body=['.md','.txt','.srt'].includes(suffix)?checked.text||'':extraction(rel,sha);sources.push({key,course:doc.course||'Other',title:title(path.basename(rel)),kind:classification.ai?'ai_draft':classification.verified_original?'file':'note',url:Array.isArray(doc.source_urls)?doc.source_urls.find((u:unknown)=>typeof u==='string'&&/^https:\/\//.test(u))||null:null,body,observed:date(doc.source_observed_at),file,originalPath:checked.originalPath,verifiedPrivate:checked.verifiedPrivate,fileSha:sha,mime:mimeFor[suffix],bytes,role:classification.verified_original?doc.source_role||doc.role:'personal_work',classification:classification.classification});
  }
  if(!statusOnly)sources=mergeObservedSources(sources,snapshotCourseSources(snapshot.records,courses.map(c=>c.code)));
  const ownerStatuses=new Map<string,ReturnType<typeof ownerSnapshotStatus>>();
  let ownerName='';try{const binding=JSON.parse(await readFile(path.join(cfg.root,'owner-moodle-binding.json'),'utf8'));if(binding.format===1&&binding.user_id===cfg.user&&binding.boundary==='verified-primary-owner-browser'&&typeof binding.display_name==='string')ownerName=binding.display_name;}catch{}
  const ownerForums=new Map<string,ReturnType<typeof ownerForumParticipation>>();
  const statusSources:SourceInput[]=[];
  for(const task of snapshot.records){const status=ownerSnapshotStatus(task,snapshotHash,snapshot.moodle_pages?.unavailable_or_failed||[]);if(!status)continue;ownerStatuses.set(task.course+'\0'+task.url,status);statusSources.push({key:'owner-status:'+task.course+':'+task.url,course:task.course,title:title(task.title),kind:'file',url:task.url,body:'Original owner activity text:\n'+task.notes,observed:status.observed_at,role:'owner_snapshot_status',classification:'Primary owner browser snapshot; exact raw status text, not Companion DOM evidence'});}
  for(const task of snapshot.records){const participation=ownerForumParticipation(task,snapshotHash,ownerName,snapshot.moodle_pages?.unavailable_or_failed||[]);if(!participation)continue;ownerForums.set(task.course+'\0'+task.url,participation);statusSources.push({key:'owner-status:'+task.course+':'+task.url,course:task.course,title:title(task.title),kind:'file',url:task.url,body:'Original owner forum text:\n'+task.notes,observed:participation.observed_at,role:'owner_snapshot_participation',classification:'Observed own participation only; no official date, author-role, full-completion or grade authority'});}
  for(const statusSource of statusSources){const at=sources.findIndex(s=>s.key===statusSource.key);if(at<0)sources.push(statusSource);else if(statusSource.observed!>=String(sources[at].observed||''))sources[at]=statusSource;}

  let cachedNotes:any[]=[];
  if(!statusOnly&&env.SCHOOL_PERSONAL_IMPORT_PRESERVE_NOTES!=='1')try{const db=new DatabaseSync(cfg.notes,{readOnly:true});try{cachedNotes=db.prepare("SELECT id,course,title,body,transcript,summary,origin,source_url,external_id,created_at,updated_at FROM notes WHERE account='personal-acadia'").all();}finally{db.close();}}catch(e:any){if(e.code!=='ENOENT')throw Error('Cached personal notebook could not be read in read-only mode.');warnings.push({key:'personal-notebook',reason:'Cached personal SQLite notebook is unavailable.'});}
  let noteInputs=cachedNotes.map(n=>({key:'notebook:'+String(n.external_id||n.id),course:n.course||'Other',title:title(n.title),body:String(n.body||''),transcript:String(n.transcript||''),summary:String(n.summary||''),kind:n.origin==='assistant_draft'?'ai_draft':'note',url:n.source_url||null,created:date(n.created_at),updated:date(n.updated_at),origin:n.origin==='notion_reference'?'imported_personal_notebook':n.origin==='assistant_draft'?'ai_draft':'imported_personal_note'}));
  for(const r of snapshot.records.filter((r:any)=>!statusOnly&&env.SCHOOL_PERSONAL_IMPORT_PRESERVE_NOTES!=='1'&&r.kind==='task'&&r.source_id==='notion'&&!r.deleted))noteInputs.push({key:'personal-plan:'+r.id,course:r.course||'Other',title:title('Personal plan · '+r.title),body:planningReference(r),transcript:'',summary:'',kind:'note',url:r.url||null,created:date(r.source_modified_at)||date(r.observed_at),updated:date(r.observed_at),origin:'imported_personal_plan'});
  if(!statusOnly&&env.SCHOOL_PERSONAL_IMPORT_PRESERVE_NOTES!=='1')noteInputs=mergeSnapshotNotebooks(noteInputs,snapshot.records);
  const courseMap=new Map<string,any>(courses.map(c=>[c.code,c]));for(const code of [...sources.map(s=>s.course),...noteInputs.map(n=>n.course),...snapshot.records.filter((r:any)=>r.kind==='task'&&r.authority==='Moodle'&&r.source_id==='moodle').map((r:any)=>r.course||'Other')])if(!courseMap.has(code))courseMap.set(code,{code,name:code});
  const candidateMap:ImportMap={version:1,user_id:cfg.user,items:{...map.items}};
  const saveSource=async(c:PoolClient,s:SourceInput)=>{
   const courseId=deterministicId(cfg.user,'course:'+s.course),sourceId=deterministicId(cfg.user,s.key),old=(await c.query('SELECT s.kind,s.current_version,v.sha256,v.body FROM schoolvault.sources s LEFT JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.id=s.current_version WHERE s.user_id=$1 AND s.id=$2 FOR UPDATE OF s',[cfg.user,sourceId])).rows[0];
   // Once known to be AI prior work, a new hash with incomplete metadata must
   // not silently make it an original source. Positive original provenance is
   // required to remove that exclusion; immutable versions remain untouched.
   if(old?.kind==='ai_draft'&&['file','note'].includes(s.kind)&&s.file&&!s.classification?.startsWith('hash-matching original-source role:')){s.kind='ai_draft';warnings.push({key:s.key,reason:'Existing AI prior-work exclusion retained until changed artifact authorship is positively reviewed.'});}
   const normalized=normalizeImportedText(s.body),clipped=clipImportedText(normalized.body);if(normalized.replaced_nuls)warnings.push({key:s.key,reason:String(normalized.replaced_nuls)+' embedded NUL characters replaced in searchable text; original bytes and SHA remain unchanged.'});if(clipped.clipped)warnings.push({key:s.key,reason:'Searchable text clipped to 80,000 characters; original retained.'});
   const header=s.role==='moodle_receipt_observation'?'Saved Moodle receipt/grade observation from the checksum-verified owner snapshot. Preserve published versus unpublished and unmapped items; do not match a grade to an activity by title or infer a new submission.':s.role==='moodle_observation'?'Stored Moodle observation from the checksum-verified owner snapshot; this is saved record text, not a new live check or a guarantee of complete page coverage.':s.role==='course_email'?'Saved course correspondence; preserve sender and observation time. This is not a Moodle receipt.':s.role==='moodle_task_record'?'Imported saved Moodle task record; this is dated saved evidence, not a complete activity page or a live Moodle check.':s.kind==='moodle'?'Imported saved Moodle capture; this is dated saved evidence, not a live Moodle check.':s.kind==='ai_draft'?'AI-written study draft; this is not an original course source.':s.role==='personal_work'?'Imported personal course work; this is not instructor material.':'Imported saved course source.';
   // Empty extracted text must stay empty: provenance headers alone would make
   // coverage/UI counts incorrectly call an unread PDF searchable.
   const body=clipped.body.trim()?[header,'Original source observation: '+(s.observed||'Unknown; the import time is not an official source check.'),s.role?'Source role: '+s.role:'',s.classification?'Source provenance: '+s.classification:'',clipped.body].filter(Boolean).join('\n\n'):'';
   const sha=s.fileSha||digest(body),versionId=deterministicId(cfg.user,s.key+':version:'+sha+':'+digest(body));
   if(!old){await checkObjects(c,cfg.user,'sources');await c.query('INSERT INTO schoolvault.sources(user_id,id,course_id,kind,title,original_url) VALUES($1,$2,$3,$4,$5,$6)',[cfg.user,sourceId,courseId,s.kind,s.title,s.url]);counts.sources_added++;}
   else{await c.query('UPDATE schoolvault.sources SET title=$3,original_url=$4,kind=$5 WHERE user_id=$1 AND id=$2',[cfg.user,sourceId,s.title,s.url,s.kind]);if(old.kind!==s.kind){counts.sources_reclassified++;await c.query('INSERT INTO schoolvault.audit(user_id,id,action,target,details) VALUES($1,$2,$3,$4,$5)',[cfg.user,deterministicId(cfg.user,'classification:'+started+':'+sourceId),'local-source-provenance-correction',sourceId,JSON.stringify({from:old.kind,to:s.kind,classification:s.classification||'explicit imported notebook provenance',original_sha256:s.fileSha||null})]);}}
   const exists=(await c.query('SELECT id FROM schoolvault.source_versions WHERE user_id=$1 AND id=$2',[cfg.user,versionId])).rows[0];
   let objectKey:string|null=null;if(s.file){objectKey=deterministicId(cfg.user,'object:'+s.key+':'+sha);const destination=path.join(ownerFiles,objectKey);
    try{if((await lstat(destination)).isSymbolicLink())throw Error('Existing local original cannot be a symlink.');const present=s.verifiedPrivate&&s.file===destination?sha:(await retentionIO!.run({root:cfg.files,relative:path.relative(cfg.files,destination)})).sha256;if(present!==sha)throw Error('Existing local original failed its integrity check.');}catch(e:any){if(e.code!=='ENOENT')throw e;
     const used=Number((await c.query('SELECT coalesce(sum(bytes),0) AS used FROM (SELECT object_key,max(bytes) AS bytes FROM schoolvault.source_versions WHERE user_id=$1 AND object_key IS NOT NULL GROUP BY object_key) x',[cfg.user])).rows[0].used),vault=(await c.query('SELECT quota_bytes FROM schoolvault.vaults WHERE user_id=$1',[cfg.user])).rows[0];
     if(used+(s.bytes||0)>Number(vault.quota_bytes))throw Error('Local original-file quota would be exceeded.');const disk=await statfs(ownerFiles);if(Number(disk.bavail)*Number(disk.bsize)<(s.bytes||0)+512*1024**2)throw Error('Not enough local disk space to retain originals safely.');
     const temporary=destination+'.pending-'+randomUUID();await retentionIO!.run({root:s.verifiedPrivate?cfg.files:cfg.vault,relative:path.relative(s.verifiedPrivate?cfg.files:cfg.vault,s.file),operation:'copy',expectedSha:sha,destinationRoot:cfg.files,destination:temporary,basename:path.basename(temporary)});await rename(temporary,destination);copied.push(destination);counts.originals_copied++;counts.originals_bytes+=s.bytes||0;
    }
    const registered=(await c.query('SELECT id FROM schoolvault.source_versions WHERE user_id=$1 AND object_key=$2 LIMIT 1',[cfg.user,objectKey])).rowCount;
    if(!registered){const used=Number((await c.query('SELECT coalesce(sum(bytes),0) AS used FROM (SELECT object_key,max(bytes) AS bytes FROM schoolvault.source_versions WHERE user_id=$1 AND object_key IS NOT NULL GROUP BY object_key) x',[cfg.user])).rows[0].used),vault=(await c.query('SELECT quota_bytes FROM schoolvault.vaults WHERE user_id=$1',[cfg.user])).rows[0];if(used+(s.bytes||0)>Number(vault.quota_bytes))throw Error('Local original-file quota would be exceeded.');const admitted=await c.query('UPDATE schoolvault.storage_budget SET used_bytes=used_bytes+$1 WHERE id=true AND used_bytes+$1<=limit_bytes RETURNING used_bytes',[s.bytes]);if(!admitted.rowCount)throw Error('Local shared storage budget would be exceeded.');}
   }
   let keepNative=false;
   if(old?.sha256===sha&&old.body!==body&&s.mime===mimeFor['.docx']&&['file','note'].includes(old.kind)&&['file','note'].includes(s.kind)){
    const native=(await c.query("SELECT status,result FROM schoolvault.jobs WHERE user_id=$1 AND kind='extract' AND status='complete' AND result->>'source_id'=$2 AND result->>'version_id'=$3 ORDER BY updated_at DESC LIMIT 1",[cfg.user,sourceId,old.current_version])).rows[0];
    keepNative=retainNativeWordExtraction({...old,source_id:sourceId},{sha256:sha,mime:s.mime},native);
    if(keepNative)warnings.push({key:s.key,reason:'Verified native Word extraction retained for unchanged original bytes; upstream index text differs.'});
   }
   if(old?.sha256===sha&&(old?.body===body||keepNative)){counts.sources_unchanged++;candidateMap.items[s.key]={...candidateMap.items[s.key],id:sourceId,version_id:old.current_version,sha256:sha,upstream_observed_at:s.observed,...(s.file?{original_path:s.originalPath||path.relative(cfg.vault,s.file),original_sha256:sha,original_bytes:s.bytes}:{})};return {id:sourceId,version:old.current_version};}
   if(!exists){await c.query('INSERT INTO schoolvault.source_versions(user_id,id,source_id,body,sha256,observed_at,object_key,mime,bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[cfg.user,versionId,sourceId,body,sha,s.observed||started,objectKey,s.mime||null,s.bytes||0]);
    for(let offset=0,ordinal=0;offset<body.length;offset+=3500,ordinal++)await c.query('INSERT INTO schoolvault.passages(user_id,id,source_id,version_id,ordinal,body) VALUES($1,$2,$3,$4,$5,$6)',[cfg.user,deterministicId(cfg.user,versionId+':passage:'+ordinal),sourceId,versionId,ordinal,body.slice(offset,offset+4000)]);counts.versions_added++;
   }
   await c.query('UPDATE schoolvault.sources SET current_version=$3 WHERE user_id=$1 AND id=$2',[cfg.user,sourceId,versionId]);candidateMap.items[s.key]={id:sourceId,version_id:versionId,sha256:sha,upstream_observed_at:s.observed,...(s.file?{original_path:s.originalPath||path.relative(cfg.vault,s.file),original_sha256:sha,original_bytes:s.bytes}:{})};return {id:sourceId,version:versionId};
  };
  const sourceByUrl=new Map<string,{id:string;version:string}>();let calendarHolidays:any[]=[];
  retentionIO=importFileIO({fileMs:2000,budgetMs:60000});
  await tenant(cfg.user,async c=>{
   await lockVault(c,cfg.user);const account=(await c.query('SELECT schoolvault.local_owner_ready($1) AS ready',[cfg.user])).rows[0];if(!account?.ready)throw Error('Import requires the enabled local owner tenant.');
   const actual=(await c.query('SELECT current_database() AS name')).rows[0];if(actual?.name!=='schoolvault_local')throw Error('Connected database is not the isolated local database.');
   for(const [code,course]of courseMap){const id=deterministicId(cfg.user,'course:'+code),old=(await c.query('SELECT id FROM schoolvault.courses WHERE user_id=$1 AND id=$2',[cfg.user,id])).rows[0];if(!old)await checkObjects(c,cfg.user,'courses');await c.query('INSERT INTO schoolvault.courses(user_id,id,code,title,moodle_id,url,kind) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id,id) DO UPDATE SET code=excluded.code,title=excluded.title,url=excluded.url',[cfg.user,id,code,title(course.name||code),course.id?String(course.id):null,course.url||null,/L$/.test(code)?'lab':['MASH','Study Skills','AI for Everyone'].includes(code)?'support':'lecture']);counts.courses++;}
   for(const s of sources){const beforeCounts={...counts};await c.query('SAVEPOINT import_source_file');let saved:{id:string;version:string};try{saved=await saveSource(c,s);await c.query('RELEASE SAVEPOINT import_source_file');}catch(e){if(!(e instanceof ImportFileGap))throw e;await c.query('ROLLBACK TO SAVEPOINT import_source_file');await c.query('RELEASE SAVEPOINT import_source_file');Object.assign(counts,beforeCounts);const gap=[...io.gaps,...retentionIO!.gaps].findLast(g=>g.path===e.file&&g.operation===e.operation);if(gap&&s.file)gap.path=s.originalPath||path.relative(cfg.vault,s.file);counts.skipped++;continue;}if((s.kind==='moodle'||s.role==='owner_snapshot_status'||s.role==='owner_snapshot_participation')&&s.url)sourceByUrl.set(s.course+'\0'+s.url,saved);
    if(env.SCHOOL_PERSONAL_IMPORT_PRESERVE_NOTES!=='1'&&(s.kind==='ai_draft'||s.kind==='note'&&s.role==='personal_work'&&s.file)){
     // A file-backed AI note points to the existing original-bearing source.
     // Never call saveSource with notebook text here: that would replace the
     // original version/object/hash with a text-only note version.
     const ai=s.kind==='ai_draft',key=s.key+(ai?':ai-notebook':':personal-notebook'),noteId=deterministicId(cfg.user,key),old=(await c.query('SELECT * FROM schoolvault.notes WHERE user_id=$1 AND id=$2 FOR UPDATE',[cfg.user,noteId])).rows[0],previous=map.items[key];
     const noteTitle=title(s.title),body=(ai?aiOriginalNotebookBody:personalOriginalNotebookBody)({...saved,title:s.title,body:s.body,observed:s.observed});
     const incoming=JSON.stringify({title:noteTitle,body,transcript:'',summary:''}),current=old?JSON.stringify({title:old.title,body:old.body,transcript:old.transcript,summary:old.summary}):'',decision=old?noteRefreshDecision(current,previous?.imported_note_sha256,incoming):'refresh';
     if(decision==='preserve_local_edit'){counts.local_note_edits_preserved++;warnings.push({key,reason:'Local notebook edits preserved; original source refreshed separately.'});continue;}
     if(decision==='unchanged')counts.notes_unchanged++;
     else if(!old){await checkObjects(c,cfg.user,'notes');await c.query('INSERT INTO schoolvault.notes(user_id,id,course_id,source_id,title,body,origin,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)',[cfg.user,noteId,deterministicId(cfg.user,'course:'+s.course),saved.id,noteTitle,body,ai?'ai_draft':'imported_personal_reference',s.observed||started]);counts.notes_added++;}
     else{await c.query('INSERT INTO schoolvault.note_revisions(user_id,id,note_id,version,snapshot) VALUES($1,$2,$3,$4,$5)',[cfg.user,deterministicId(cfg.user,key+':revision:'+old.version+':'+digest(JSON.stringify(old))),noteId,old.version,JSON.stringify(old)]);await c.query('UPDATE schoolvault.notes SET title=$3,body=$4,version=version+1,updated_at=$5 WHERE user_id=$1 AND id=$2',[cfg.user,noteId,noteTitle,body,s.observed||started]);counts.notes_refreshed++;}
     candidateMap.items[key]={id:saved.id,version_id:saved.version,note_id:noteId,imported_body_sha256:digest(body),imported_note_sha256:digest(incoming),upstream_observed_at:s.observed};
    }
   }
   for(const n of noteInputs){for(const field of ['body','transcript','summary'] as const){const normalized=normalizeImportedText(n[field]);if(normalized.replaced_nuls)warnings.push({key:n.key,reason:String(normalized.replaced_nuls)+' embedded NUL characters replaced in cached notebook '+field+'.'});n[field]=normalized.body;}const noteId=deterministicId(cfg.user,n.key+':note'),old=(await c.query('SELECT * FROM schoolvault.notes WHERE user_id=$1 AND id=$2 FOR UPDATE',[cfg.user,noteId])).rows[0],previous=map.items[n.key];
    const full=[n.body,n.transcript].filter(Boolean).join('\n'),clipped=clipImportedText(full),incoming=clipImportedText(n.body).body;if(clipped.clipped)warnings.push({key:n.key,reason:'Cached notebook text clipped to 80,000 characters.'});
    const incomingNote=JSON.stringify({title:n.title,body:incoming,transcript:n.transcript.slice(0,80_000),summary:n.summary.slice(0,80_000)}),currentNote=old?JSON.stringify({title:old.title,body:old.body,transcript:old.transcript,summary:old.summary}):'';
    const decision=old?noteRefreshDecision(currentNote,previous?.imported_note_sha256,incomingNote):'refresh';
    if(decision==='preserve_local_edit'){counts.local_note_edits_preserved++;warnings.push({key:n.key,reason:'Local notebook edits preserved; changed upstream copy was not applied.'});continue;}
    if(decision==='unchanged'){counts.notes_unchanged++;candidateMap.items[n.key]={...previous,id:old.source_id,note_id:noteId,imported_body_sha256:digest(incoming),imported_note_sha256:digest(incomingNote)};continue;}
    const saved=await saveSource(c,{key:n.key,course:n.course,title:n.title,kind:n.kind as SourceInput['kind'],url:n.url,body:clipped.body,observed:n.updated,role:'personal_work'});
    if(!old){await checkObjects(c,cfg.user,'notes');await c.query('INSERT INTO schoolvault.notes(user_id,id,course_id,source_id,title,body,transcript,summary,origin,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[cfg.user,noteId,deterministicId(cfg.user,'course:'+n.course),saved.id,n.title,incoming,n.transcript.slice(0,80_000),n.summary.slice(0,80_000),n.origin,n.created||started,n.updated||started]);counts.notes_added++;}
    else{await c.query('INSERT INTO schoolvault.note_revisions(user_id,id,note_id,version,snapshot) VALUES($1,$2,$3,$4,$5)',[cfg.user,deterministicId(cfg.user,n.key+':revision:'+old.version+':'+digest(JSON.stringify(old))),noteId,old.version,JSON.stringify(old)]);await c.query('UPDATE schoolvault.notes SET title=$3,body=$4,transcript=$5,summary=$6,version=version+1,updated_at=$7 WHERE user_id=$1 AND id=$2',[cfg.user,noteId,n.title,incoming,n.transcript.slice(0,80_000),n.summary.slice(0,80_000),n.updated||started]);counts.notes_refreshed++;}
    candidateMap.items[n.key]={...candidateMap.items[n.key],note_id:noteId,imported_body_sha256:digest(incoming),imported_note_sha256:digest(incomingNote)};
   }
   for(const task of snapshot.records.filter((r:any)=>r.kind==='task'&&r.authority==='Moodle'&&r.source_id==='moodle'&&(!statusOnly||(ownerStatuses.has(r.course+'\0'+r.url)||ownerForums.has(r.course+'\0'+r.url))))){const taskCourse=task.course||'Other';let source=sourceByUrl.get(taskCourse+'\0'+task.url);
    if(!source){let activity:URL;try{activity=new URL(task.url);}catch{warnings.push({key:'task:'+task.id,reason:'Saved task activity URL is invalid; task skipped.'});continue;}if(activity.origin!=='https://moodle.acadiau.ca'||activity.username||activity.password||activity.hash||!/^\/mod\/[a-z]+\/view\.php$/.test(activity.pathname)||[...activity.searchParams.keys()].length!==1||!/^\d{1,12}$/.test(activity.searchParams.get('id')||'')){warnings.push({key:'task:'+task.id,reason:'Saved task activity identity is not an exact Moodle activity URL; task skipped.'});continue;}
     source=await saveSource(c,{key:'moodle:'+taskCourse+':'+task.url,course:taskCourse,title:title(String(task.title||'Activity')+' · saved task record'),kind:'moodle',url:task.url,body:savedMoodleTaskRecord(task),observed:date(task.observed_at),role:'moodle_task_record'});sourceByUrl.set(taskCourse+'\0'+task.url,source);warnings.push({key:'task:'+task.id,reason:'Only explicit saved task-record fields were imported; full activity-page content is unavailable.'});
    }
    const due=typeof task.due==='string'?task.due:'',dueAt=/T\d{2}:\d{2}/.test(due)?date(due):null,dueDate=dateOnly(due)?due:null;const observed=date(task.observed_at);if(!observed)continue;
    const evidence={owner_snapshot_participation:ownerForums.get(taskCourse+'\0'+task.url)||null,owner_snapshot_status:ownerStatuses.get(taskCourse+'\0'+task.url)||null,title:title(task.title),kind:/\/quiz\//.test(task.url)?'quiz':'assignment',due_at:dueAt,due_date:dueDate,authority:'Saved Moodle observation',provider:'moodle',activity_url:task.url,version_id:source.version,observed_at:observed,timezone:snapshot.timezone||'America/Halifax',note:'Imported saved observation; refresh Moodle to verify current requirements. No submission or grade is inferred.'};
    await c.query('INSERT INTO schoolvault.tasks(user_id,id,course_id,source_id,external_id,evidence,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id,course_id,external_id) DO UPDATE SET source_id=excluded.source_id,evidence=excluded.evidence,observed_at=excluded.observed_at WHERE schoolvault.tasks.observed_at<=excluded.observed_at',[cfg.user,deterministicId(cfg.user,'task:'+taskCourse+':'+task.url),deterministicId(cfg.user,'course:'+taskCourse),source.id,task.url,JSON.stringify(evidence),observed]);counts.tasks++;
   }
   const holidays=statusOnly?{complete:false,dates:[] as string[],retained:[],issues:[]}:await reviewedNoClassDates(timetable.holidays,async(s:any)=>{const file=await material(s.path);return !!file&&file.sha256===s.sha256;});
   warnings.push(...holidays.issues);const excludedDates=holidays.dates;calendarHolidays=holidays.retained;
   for(const meeting of statusOnly?[]:timetable.classes||[]){if(!holidays.complete){warnings.push({key:'meeting:'+meeting.id,reason:'No-class date evidence is incomplete; previous timetable retained without changes.'});continue;}const valid=await Promise.all((meeting.sources||[]).map(async(s:any)=>{const file=await material(s.path);return !!file&&file.sha256===s.sha256;}));if(!valid.length||valid.some(v=>!v)){warnings.push({key:'meeting:'+meeting.id,reason:'Reviewed timetable source hash is missing or changed; meeting skipped.'});continue;}
    const src=await saveSource(c,{key:'timetable:'+meeting.id,course:meeting.course,title:title(meeting.title+' · reviewed timetable'),kind:'note',url:null,body:'Previously reviewed local timetable. Source versions matched at import.\n'+JSON.stringify(meeting)+'\nReview recorded: '+String(timetable.reviewed_at||'Not recorded'),observed:date(timetable.reviewed_at),role:'reviewed_timetable'});
    const schedule={...meeting,excluded_dates:[...new Set(excludedDates)],authority:'Previously reviewed owner timetable',version_id:src.version,reviewed_at:timetable.reviewed_at,imported_at:started};await c.query('INSERT INTO schoolvault.meetings(user_id,id,course_id,source_id,schedule) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,id) DO UPDATE SET source_id=excluded.source_id,schedule=excluded.schedule',[cfg.user,deterministicId(cfg.user,'meeting:'+meeting.id),deterministicId(cfg.user,'course:'+meeting.course),src.id,JSON.stringify(schedule)]);counts.meetings++;
   }
   warnings.push({key:'submission-and-grades',reason:'Exact supported owner-browser status rows and numbered attempts are available only in the guarded local owner profile, with original observation/freshness/source bindings. Unsupported, hidden, stale and forum evidence remains separate; no grade is promoted.'});
   const totals=(await c.query(`SELECT
    (SELECT count(*)::int FROM schoolvault.courses WHERE user_id=$1) AS courses,
    (SELECT count(*)::int FROM schoolvault.notes WHERE user_id=$1) AS notes,
    (SELECT count(*)::int FROM schoolvault.sources WHERE user_id=$1) AS sources,
    (SELECT count(DISTINCT object_key)::int FROM schoolvault.source_versions WHERE user_id=$1 AND object_key IS NOT NULL) AS files,
    (SELECT count(*)::int FROM schoolvault.tasks WHERE user_id=$1) AS tasks,
    (SELECT count(*)::int FROM schoolvault.meetings WHERE user_id=$1) AS meetings`,[cfg.user])).rows[0];Object.assign(counts,totals);
   await c.query('INSERT INTO schoolvault.audit(user_id,id,action,details) VALUES($1,$2,$3,$4)',[cfg.user,deterministicId(cfg.user,'import:'+started),'local-personal-import',JSON.stringify({snapshot_sha256:snapshotHash,index_sha256:digest(indexBytes),register_sha256:digest(registerBytes),snapshot_at:snapshot.generated_at,index_at:index.built_at,counts})]);await checkHistory(c,cfg.user);
  });
  for(const gap of [...io.gaps,...(retentionIO?.gaps||[])])warnings.push({key:gap.path,reason:'File '+gap.operation+' skipped: '+gap.reason+'. Previous imported version retained; this file was not refreshed.'});
  await privateJson(mapFile,candidateMap);
  const receipt={version:1,started_at:started,finished_at:new Date().toISOString(),source_selection:{generated_outputs_excluded:generatedOutputs},private_original_reuse:{count:new Set(reused.map(r=>r.path)).size,records:reused,scope:'Retained bytes independently rehashed against immutable owner version/import map and pinned index digest; not a new iCloud or Moodle read.'},file_io:{budget_ms:240000,scan_budget_ms:180000,retention_budget_ms:60000,file_timeout_ms:2000,elapsed_ms:Math.round(io.elapsed()),gaps:[...io.gaps,...(retentionIO?.gaps||[])],complete:io.gaps.length===0&&!retentionIO?.gaps.length&&counts.skipped===0},scope:'isolated-local-owner-tenant',refresh_kind:statusOnly?'owner-status-only':'full-personal-vault',notes_preserved:env.SCHOOL_PERSONAL_IMPORT_PRESERVE_NOTES==='1',user_id:cfg.user,snapshot_sha256:snapshotHash,snapshot_at:snapshot.generated_at,index_sha256:digest(indexBytes),index_at:index.built_at,register_sha256:digest(registerBytes),counts,warnings,warning_count:warnings.length,calendar_holidays_retained:calendarHolidays,primary_writes:false,notion_api_calls:0,cloud_writes:false};
  await privateJson(path.join(cfg.root,'personal-import-receipt.json'),receipt);console.log(JSON.stringify({saved:true,counts,warning_count:warnings.length,receipt:path.join(cfg.root,'personal-import-receipt.json')}));return receipt;
 }catch(error){
  // A COMMIT response may be ambiguous: retain copied originals for reconciliation.
  // A later import verifies and reuses their deterministic paths instead of deleting.
  if(copied.length)await privateJson(path.join(cfg.root,'personal-import-reconcile.json'),{started_at:started,copied_originals:copied,reason:'Import failed or commit acknowledgement was ambiguous; originals retained.'});
  const errorDetails={started_at:started,failed_at:new Date().toISOString(),name:error instanceof Error?error.name:'Unknown',message:error instanceof Error?error.message.slice(0,2000):'Unknown failure',stack:error instanceof Error?String(error.stack||'').slice(0,6000):'',primary_writes:false,cloud_writes:false};
  await privateJson(path.join(cfg.root,'personal-import-error.json'),errorDetails);await privateJson(path.join(cfg.root,'personal-import-failure.json'),{...errorDetails,error_type:errorDetails.name});throw error;
 }finally{await closeBetaPool();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){importPersonalLocal().catch(()=>{console.error('Local personal import failed. Existing owner data and production services were preserved; inspect the private local receipt/reconciliation file.');process.exitCode=1;});}
