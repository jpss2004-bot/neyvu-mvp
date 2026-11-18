import {createHash,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {BetaHttpError} from './http';

const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const positive=(v:unknown):v is string=>typeof v==='string'&&/^[1-9]\d{0,11}$/.test(v);
const hex=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const exact=(v:any,keys:string[])=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));
const invalid=():never=>{throw new BetaHttpError('Invalid post-bound Moodle evidence.');};
export type ForumPost={post_id:string;author_id:string;profile_url:string;start:number;end:number;sha256:string};
export type CourseRole={state:'observed_course_roles';profile_url:string;course_id:string;author_id:string;viewer_id:string;context_id:string;roles:{role_id:string;label:string}[];observed_at:string};
export type ForumEvidence={format:1;state:'observed_posts'|'unavailable';discussion_id:string;activity_id:string;body_sha256:string;posts:ForumPost[];roles:CourseRole[];issues:string[]};
const issueCodes=['unsupported_layout','role_unavailable','role_limit','discussion_changed'] as const;
function profileURL(value:any,author:string,course:string){
 if(typeof value!=='string'||value.length>200)return false;
 try{const u=new URL(value),keys=[...u.searchParams.keys()];return u.origin==='https://moodle.acadiau.ca'&&!u.username&&!u.password&&!u.hash&&u.pathname==='/user/view.php'&&keys.length===2&&new Set(keys).size===2&&keys.includes('id')&&keys.includes('course')&&u.searchParams.get('id')===author&&u.searchParams.get('course')===course&&u.href===value;}catch{return false;}
}
// These checks bind observations to saved bytes; a paired student device does
// not attest Moodle truth or grant a role permission. Authority stays unverified.
export function forumEvidence(raw:any,data:{url:string;body:string;identity:string;course:{id:string};captured_at:string}):ForumEvidence|null{
 if(raw==null)return null;
 const discussion=data.url.match(/^https:\/\/moodle\.acadiau\.ca\/mod\/forum\/discuss\.php\?d=([1-9]\d{0,11})$/),viewer=data.identity.match(/^moodle-user:([1-9]\d{0,11})(?:\s*·.*)?$/)?.[1];
 if(!discussion||!viewer||!positive(data.course.id)||!exact(raw,['format','state','discussion_id','activity_id','body_sha256','posts','roles','issues'])||raw.format!==1||!['observed_posts','unavailable'].includes(raw.state)||raw.discussion_id!==discussion[1]||!positive(raw.activity_id)||!hex(raw.body_sha256)||raw.body_sha256!==hash(data.body)||!Array.isArray(raw.posts)||raw.posts.length>100||!Array.isArray(raw.roles)||raw.roles.length>20||!Array.isArray(raw.issues)||raw.issues.length>4||new Set(raw.issues).size!==raw.issues.length||raw.issues.some((x:any)=>!issueCodes.includes(x))||Buffer.byteLength(JSON.stringify(raw))>65536)invalid();
 // PostgreSQL UTF-8 cannot retain lone surrogates; never reinterpret offsets.
 if(!data.body.isWellFormed()||data.body.includes('\0'))invalid();
 let previousEnd=0;const seen=new Set<string>();
 const boundary=(n:number)=>n===0||n===data.body.length||!(data.body.charCodeAt(n)>=0xdc00&&data.body.charCodeAt(n)<=0xdfff);
 const posts:ForumPost[]=raw.posts.map((p:any)=>{
  if(!exact(p,['post_id','author_id','profile_url','start','end','sha256'])||!positive(p.post_id)||seen.has(p.post_id)||!positive(p.author_id)||!profileURL(p.profile_url,p.author_id,data.course.id)||!Number.isSafeInteger(p.start)||!Number.isSafeInteger(p.end)||p.start<previousEnd||p.end<=p.start||p.end>data.body.length||!boundary(p.start)||!boundary(p.end)||!hex(p.sha256)||hash(data.body.slice(p.start,p.end))!==p.sha256)invalid();
  seen.add(p.post_id);previousEnd=p.end;return {...p};
 });
 const authors=new Set<string>(),captureTime=Date.parse(data.captured_at);
 const roles:CourseRole[]=raw.roles.map((r:any)=>{
  if(!exact(r,['state','profile_url','course_id','author_id','viewer_id','context_id','roles','observed_at'])||r.state!=='observed_course_roles'||!positive(r.author_id)||authors.has(r.author_id)||!posts.some(p=>p.author_id===r.author_id&&p.profile_url===r.profile_url)||r.course_id!==data.course.id||r.viewer_id!==viewer||!positive(r.context_id)||!profileURL(r.profile_url,r.author_id,data.course.id)||!Array.isArray(r.roles)||!r.roles.length||r.roles.length>20||typeof r.observed_at!=='string'||!Number.isFinite(Date.parse(r.observed_at))||Date.parse(r.observed_at)>captureTime||Date.parse(r.observed_at)<captureTime-300000)invalid();
  const ids=new Set<string>();for(const role of r.roles){if(!exact(role,['role_id','label'])||!positive(role.role_id)||ids.has(role.role_id)||typeof role.label!=='string'||!role.label.trim()||role.label!==role.label.trim()||role.label.length>120||/[\x00-\x1f\x7f]/.test(role.label)||!role.label.isWellFormed())invalid();ids.add(role.role_id);}
  authors.add(r.author_id);return {...r,observed_at:new Date(r.observed_at).toISOString(),roles:r.roles.map((v:any)=>({...v}))};
 });
 if(raw.state==='unavailable'&&(posts.length||roles.length||!raw.issues.length)||raw.state==='observed_posts'&&!posts.length)invalid();
 if(raw.state==='observed_posts'&&posts.some(p=>!authors.has(p.author_id))&&!raw.issues.some((v:string)=>['role_unavailable','role_limit'].includes(v)))invalid();
 return {format:1,state:raw.state,discussion_id:raw.discussion_id,activity_id:raw.activity_id,body_sha256:raw.body_sha256,posts,roles,issues:[...raw.issues]};
}
const canonical=(v:any):string=>JSON.stringify(v===null?null:Array.isArray(v)?v.map(x=>JSON.parse(canonical(x))):typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canonical(v[k]))])):v);
const semantic=(proof:ForumEvidence|null)=>canonical(proof?{...proof,roles:proof.roles.map(({observed_at,...r})=>r)}:null);
export async function saveForumObservation(c:PoolClient,user:string,data:{source:string;version:string;device:string;identity:string;url:string;body:string;captured_at:string;proof:ForumEvidence|null;synthetic:boolean}){
 if(!/^https:\/\/moodle\.acadiau\.ca\/mod\/forum\/discuss\.php\?d=[1-9]\d{0,11}$/.test(data.url))return;
 const sha=hash(data.body),provenance=data.synthetic?'synthetic_capture':'signed_in_capture',proofHash=hash(semantic(data.proof));
 const roleTimes=Object.fromEntries((data.proof?.roles||[]).map(r=>[r.author_id,r.observed_at]));
 const previous=(await c.query(`SELECT e.*,k.captured_at AS checked_at,k.role_times FROM schoolvault.moodle_forum_evidence e
  JOIN schoolvault.moodle_forum_checks k ON k.user_id=e.user_id AND k.source_id=e.source_id AND k.evidence_id=e.id WHERE e.user_id=$1 AND e.source_id=$2`,[user,data.source])).rows[0];
 const same=(r:any)=>r&&r.version_id===data.version&&r.device_id===data.device&&r.identity_key===data.identity&&r.activity_url===data.url&&r.body_sha256===sha&&r.proof_sha256===proofHash&&r.provenance===provenance;
 const conflict=()=>{throw new BetaHttpError('This capture time already has different forum evidence. Refresh Moodle.',409);};
 const old=(await c.query('SELECT * FROM schoolvault.moodle_forum_evidence WHERE user_id=$1 AND source_id=$2 AND captured_at=$3',[user,data.source,data.captured_at])).rows[0];
 if(old&&(!same(old)||canonical(old.proof)!==canonical(data.proof)))conflict();
 if(previous&&Date.parse(data.captured_at)<=new Date(previous.checked_at).getTime()){
  if(Date.parse(data.captured_at)===new Date(previous.checked_at).getTime()&&(!same(previous)||canonical(previous.role_times)!==canonical(roleTimes)))conflict();
  return;
 }
 const unchanged=same(previous),id=unchanged?previous.id:randomUUID();
 if(!unchanged)await c.query(`INSERT INTO schoolvault.moodle_forum_evidence(user_id,id,source_id,version_id,device_id,identity_key,activity_url,body_sha256,proof_sha256,captured_at,proof,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[user,id,data.source,data.version,data.device,data.identity,data.url,sha,proofHash,data.captured_at,data.proof?JSON.stringify(data.proof):null,provenance]);
 await c.query(`INSERT INTO schoolvault.moodle_forum_checks(user_id,source_id,evidence_id,captured_at,role_times) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,source_id) DO UPDATE SET evidence_id=excluded.evidence_id,captured_at=excluded.captured_at,role_times=excluded.role_times,received_at=clock_timestamp()`,[user,data.source,id,data.captured_at,JSON.stringify(roleTimes)]);
}
export async function forumObservation(c:PoolClient,user:string,source:string,version:string,body:string){
 const row=(await c.query(`SELECT e.*,k.captured_at AS checked_at,k.role_times,s.current_version FROM schoolvault.moodle_forum_evidence e
  JOIN schoolvault.sources s ON s.user_id=e.user_id AND s.id=e.source_id
  LEFT JOIN schoolvault.moodle_forum_checks k ON k.user_id=e.user_id AND k.source_id=e.source_id AND k.evidence_id=e.id
  WHERE e.user_id=$1 AND e.source_id=$2 AND e.version_id=$3 ORDER BY e.captured_at DESC,e.id DESC LIMIT 1`,[user,source,version])).rows[0];
 if(!row)return null;
 if(row.body_sha256!==hash(body))throw Error('Forum observation body mismatch');
 const posts=(row.proof?.posts||[]).map((p:ForumPost)=>{
  const role=(row.proof.roles as CourseRole[]).find(r=>r.author_id===p.author_id);
  return {...p,text:body.slice(p.start,p.end),authority:'unverified',role_observation:role?{...role,observed_at:row.role_times?.[p.author_id]||role.observed_at}:null};
 });
 return {id:row.id,version_id:row.version_id,current:!!row.checked_at&&row.current_version===version,state:row.proof?.state||'not_captured',authority:'unverified',corroboration_required:true,provenance:row.provenance,observed_at:row.captured_at,checked_at:row.checked_at||row.captured_at,issues:row.proof?.issues||[],posts};
}
