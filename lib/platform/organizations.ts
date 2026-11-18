import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {tenant,uuid} from '../beta/db';
import {BetaHttpError} from '../beta/http';

// E1 organization tenancy and the institution console. Every call runs inside tenant(),
// so row-level security (migration 045) is the boundary; the checks here only produce
// clearer errors. Organization roles never grant access to a learner's private content.

export type OrgRole='learner'|'staff'|'admin';
export const orgRoles:OrgRole[]=['learner','staff','admin'];
export const sourceKinds=['policy','calendar','service','faq','page','other'] as const;
// Off by default; the console and invitations need an explicit switch.
export function institutionsEnabled(){return process.env.SCHOOL_BETA_INSTITUTIONS==='1';}
export function requireInstitutions(){if(!institutionsEnabled())throw new BetaHttpError('Institution features are not available yet.',503);}

const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const str=(v:unknown,max:number,label:string)=>{if(typeof v!=='string'||!v.trim()||v.length>max||v.includes('\0'))throw new BetaHttpError(`Enter a valid ${label}.`);return v.trim();};
const optional=(v:unknown,max:number)=>typeof v==='string'&&v.length<=max&&!v.includes('\0')?v.trim():'';
const slug=(v:unknown)=>{const s=str(v,63,'short name').toLowerCase();if(!/^[a-z0-9][a-z0-9-]{1,62}$/.test(s))throw new BetaHttpError('Use lowercase letters, numbers and dashes.');return s;};
const httpsUrl=(v:unknown)=>{const s=str(v,2000,'link');let u:URL;try{u=new URL(s);}catch{throw new BetaHttpError('Enter a valid https link.');}if(u.protocol!=='https:'||u.username||u.password)throw new BetaHttpError('Enter a valid https link.');return u.href;};
export const emailHash=(email:string)=>sha('neyvu-invite-email\0'+email.trim().toLowerCase());

export async function orgRole(c:PoolClient,org:string):Promise<OrgRole|null>{
 if(!uuid(org))return null;
 return (await c.query('SELECT schoolvault.org_role($1) AS role',[org])).rows[0]?.role??null;
}
async function need(c:PoolClient,org:unknown,roles:OrgRole[]){
 const role=typeof org==='string'?await orgRole(c,org):null;
 if(!role||!roles.includes(role))throw new BetaHttpError('Organization not found',404);
 return role;
}
export async function myOrganizations(user:string){
 return tenant(user,async c=>(await c.query('SELECT org_id,slug,name,role FROM schoolvault.my_organizations()')).rows as {org_id:string;slug:string;name:string;role:OrgRole}[]);
}

// Small cohorts are shown as "<5" so aggregate usage cannot single out a learner.
export const suppressed=(n:number)=>n>0&&n<5?'<5':String(n);
export async function orgUsage(c:PoolClient,org:string,days=30){
 const rows=(await c.query(`SELECT metric,sum(count)::int AS total,count(DISTINCT day)::int AS days FROM schoolvault.org_usage_daily
  WHERE org_id=$1 AND day>=(now() AT TIME ZONE 'UTC')::date-$2::int GROUP BY metric ORDER BY metric`,[org,days])).rows;
 const peak=(await c.query(`SELECT coalesce(max(count),0)::int AS peak FROM schoolvault.org_usage_daily WHERE org_id=$1 AND metric='active_learners' AND day>=(now() AT TIME ZONE 'UTC')::date-$2::int`,[org,days])).rows[0].peak;
 return {window_days:days,metrics:rows.map(r=>({metric:r.metric as string,total:suppressed(r.total),days:r.days as number})),peak_daily_learners:suppressed(peak)};
}

export async function orgConsole(user:string,org:string){
 requireInstitutions();
 return tenant(user,async c=>{
  const role=await need(c,org,['staff','admin']);
  const organization=(await c.query('SELECT id,slug,name,kind,data_region,settings FROM schoolvault.organizations WHERE id=$1',[org])).rows[0];
  const members=(await c.query('SELECT * FROM schoolvault.org_member_directory($1)',[org])).rows;
  const invitations=role==='admin'?(await c.query(`SELECT id,role,expires_at,accepted_at,revoked_at,created_at FROM schoolvault.org_invitations WHERE org_id=$1 ORDER BY created_at DESC LIMIT 100`,[org])).rows:[];
  const sources=(await c.query(`SELECT id,title,url,kind,review_status,review_note,reviewed_at,observed_at,length(body) AS chars FROM schoolvault.org_public_sources WHERE org_id=$1 ORDER BY review_status='approved',title`,[org])).rows;
  const journeys=(await c.query(`SELECT id,slug,title,summary,clarify,official_source_id,route,status,updated_at FROM schoolvault.org_journeys WHERE org_id=$1 ORDER BY title`,[org])).rows;
  const usage=role==='admin'?await orgUsage(c,org):null;
  return {organization,role,members,invitations,sources,journeys,usage};
 });
}

export async function inviteMember(user:string,org:string,input:{email:unknown;role:unknown;days?:unknown}){
 requireInstitutions();
 const email=str(input.email,254,'email');if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))throw new BetaHttpError('Enter a valid email.');
 if(!orgRoles.includes(input.role as OrgRole))throw new BetaHttpError('Choose a role.');
 const days=Number.isInteger(input.days)&&(input.days as number)>=1&&(input.days as number)<=30?input.days as number:14;
 const token=randomBytes(32).toString('base64url');
 const id=await tenant(user,async c=>{
  await need(c,org,['admin']);const id=randomUUID();
  await c.query(`INSERT INTO schoolvault.org_invitations(org_id,id,email_sha256,role,token_sha256,invited_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+make_interval(days=>$7))`,[org,id,emailHash(email),input.role,sha(token),user,days]);
  return id;
 });
 // The raw token is returned once for the invitation link; only its hash is stored.
 return {id,token};
}
export async function revokeInvitation(user:string,org:string,id:unknown){
 requireInstitutions();if(!uuid(id))throw new BetaHttpError('Invalid invitation.');
 return tenant(user,async c=>{await need(c,org,['admin']);return (await c.query('UPDATE schoolvault.org_invitations SET revoked_at=now() WHERE org_id=$1 AND id=$2 AND accepted_at IS NULL AND revoked_at IS NULL',[org,id])).rowCount===1;});
}
export async function acceptInvitation(user:string,email:string,token:unknown){
 requireInstitutions();if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))throw new BetaHttpError('This invitation link is not valid.');
 return tenant(user,async c=>{
  try{return (await c.query('SELECT org_id,role FROM schoolvault.accept_org_invitation($1,$2)',[sha(token),emailHash(email)])).rows[0] as {org_id:string;role:OrgRole};}
  catch(e:any){if(e?.code==='42501')throw new BetaHttpError('This invitation is not valid for your account.',403);throw e;}
 });
}
export async function updateMember(user:string,org:string,member:unknown,input:{role?:unknown;status?:unknown;remove?:unknown}){
 requireInstitutions();if(!uuid(member))throw new BetaHttpError('Invalid member.');
 return tenant(user,async c=>{
  await need(c,org,['admin']);
  try{
   if(input.remove===true)return (await c.query('DELETE FROM schoolvault.org_memberships WHERE org_id=$1 AND user_id=$2',[org,member])).rowCount===1;
   const role=input.role===undefined?null:input.role,status=input.status===undefined?null:input.status;
   if(role!==null&&!orgRoles.includes(role as OrgRole)||status!==null&&!['active','suspended'].includes(status as string))throw new BetaHttpError('Invalid change.');
   return (await c.query('UPDATE schoolvault.org_memberships SET role=coalesce($3,role),status=coalesce($4,status),updated_at=now() WHERE org_id=$1 AND user_id=$2',[org,member,role,status])).rowCount===1;
  }catch(e:any){if(e?.code==='23514')throw new BetaHttpError(e.message,409);throw e;}
 });
}

export async function addPublicSource(user:string,org:string,input:{title:unknown;url:unknown;kind?:unknown;body?:unknown}){
 requireInstitutions();
 const title=str(input.title,300,'title'),url=httpsUrl(input.url),kind=sourceKinds.includes(input.kind as any)?input.kind as string:'page',body=optional(input.body,200000);
 return tenant(user,async c=>{
  await need(c,org,['staff','admin']);
  const row=(await c.query(`INSERT INTO schoolvault.org_public_sources(org_id,id,title,url,kind,body,sha256,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
   ON CONFLICT(org_id,url) DO UPDATE SET title=excluded.title,kind=excluded.kind,body=excluded.body,sha256=excluded.sha256,observed_at=now()
   RETURNING id,review_status`,[org,randomUUID(),title,url,kind,body,sha(body),user])).rows[0];
  await c.query("SELECT schoolvault.record_org_usage('sources_added')");return row;
 });
}
export async function reviewPublicSource(user:string,org:string,id:unknown,decision:unknown,note?:unknown){
 requireInstitutions();if(!uuid(id)||!['approved','flagged','pending'].includes(decision as string))throw new BetaHttpError('Invalid review.');
 return tenant(user,async c=>{
  await need(c,org,decision==='approved'?['admin']:['staff','admin']);
  const row=(await c.query('UPDATE schoolvault.org_public_sources SET review_status=$3,review_note=$4 WHERE org_id=$1 AND id=$2 RETURNING id,review_status,reviewed_at',[org,id,decision,optional(note,1000)])).rows[0];
  if(!row)throw new BetaHttpError('Source not found',404);return row;
 });
}

export type JourneyInput={slug:unknown;title:unknown;summary?:unknown;clarify:unknown;official_source_id?:unknown;route:unknown;status?:unknown};
export function journeyFields(input:JourneyInput){
 if(!Array.isArray(input.clarify)||input.clarify.length>12)throw new BetaHttpError('Add up to 12 clarifying questions.');
 const clarify=input.clarify.map(q=>str(q,300,'clarifying question'));
 const r=input.route as any;if(!r||typeof r!=='object'||Array.isArray(r))throw new BetaHttpError('Describe the route.');
 const route={label:optional(r.label,200),office:optional(r.office,200),contact:optional(r.contact,200),url:r.url?httpsUrl(r.url):''};
 const status=input.status==='published'?'published':'draft';
 if(input.official_source_id!=null&&!uuid(input.official_source_id))throw new BetaHttpError('Choose an official source.');
 return {slug:slug(input.slug),title:str(input.title,200,'title'),summary:optional(input.summary,1000),clarify,official_source_id:(input.official_source_id as string)??null,route,status};
}
export async function saveJourney(user:string,org:string,input:JourneyInput){
 requireInstitutions();const j=journeyFields(input);
 return tenant(user,async c=>{
  await need(c,org,['staff','admin']);
  try{
   return (await c.query(`INSERT INTO schoolvault.org_journeys(org_id,id,slug,title,summary,clarify,official_source_id,route,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT(org_id,slug) DO UPDATE SET title=excluded.title,summary=excluded.summary,clarify=excluded.clarify,official_source_id=excluded.official_source_id,route=excluded.route,status=excluded.status
    RETURNING id,slug,status`,[org,randomUUID(),j.slug,j.title,j.summary,JSON.stringify(j.clarify),j.official_source_id,JSON.stringify(j.route),j.status])).rows[0];
  }catch(e:any){if(e?.code==='23514'||e?.code==='23503')throw new BetaHttpError(e.code==='23503'?'Choose a source from this organization.':e.message,409);throw e;}
 });
}

// Learner-side view used by the app and the MCP server: published journeys and approved
// institution sources for the learner's own organizations, optionally matched to a question.
export async function whatAppliesToMe(c:PoolClient,query?:string){
 const q=(query||'').trim().slice(0,300);
 const orgs=(await c.query('SELECT org_id,slug,name,role FROM schoolvault.my_organizations()')).rows;
 if(!orgs.length)return {organizations:[],journeys:[],sources:[]};
 const ids=orgs.map(o=>o.org_id);
 const journeys=(await c.query(`SELECT j.org_id,j.slug,j.title,j.summary,j.clarify,j.route,s.title AS source_title,s.url AS source_url,s.observed_at AS source_observed_at
  FROM schoolvault.org_journeys j JOIN schoolvault.org_public_sources s ON s.org_id=j.org_id AND s.id=j.official_source_id
  WHERE j.org_id=ANY($1) AND j.status='published' AND s.review_status='approved'
  AND ($2='' OR to_tsvector('english',j.title||' '||j.summary||' '||j.clarify::text) @@ websearch_to_tsquery('english',$2) OR j.title ILIKE '%'||$2||'%')
  ORDER BY j.title LIMIT 20`,[ids,q])).rows;
 const sources=(await c.query(`SELECT org_id,id,title,url,kind,observed_at,
  ts_headline('english',body,websearch_to_tsquery('english',$2),'MaxWords=40,MinWords=15') AS excerpt
  FROM schoolvault.org_public_sources WHERE org_id=ANY($1) AND review_status='approved'
  AND ($2='' OR to_tsvector('english',title||' '||body) @@ websearch_to_tsquery('english',$2))
  ORDER BY observed_at DESC LIMIT 10`,[ids,q])).rows;
 return {organizations:orgs.map(o=>({slug:o.slug,name:o.name,role:o.role})),journeys,sources};
}
export async function recordOrgUsage(c:PoolClient,metric:'questions'|'sources_added'|'journeys_opened'|'assistant_calls'){
 await c.query('SELECT schoolvault.record_org_usage($1)',[metric]);
}
