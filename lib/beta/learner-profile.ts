import type {PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import {tenant,uuid} from './db';
import {BetaHttpError} from './http';
import {BetaConflict} from './vault';
import {parseGroupReport} from './group-context-format';

// D7 learner profile (migration 041). Program, year, preferences and a section
// per course, visible and editable in Settings. Values entered by the learner
// are always stored and shown as student-reported; only a connector with a
// proof reference may write platform_verified (not exposed to the browser).
// Course group corrections from student memory appear as read-only sections
// labelled student-reported. Flag: SCHOOL_BETA_LEARNER_PROFILE=1 (default off).
export const learnerProfileEnabled=()=>process.env.SCHOOL_BETA_LEARNER_PROFILE==='1';
export const profileFields=['program','year_of_study','language','answer_length','explanation_style','section','timezone','accessibility'] as const;
export type ProfileField=typeof profileFields[number];
export type ProfileFact={id:string;field:ProfileField;course_id:string|null;value:string;authority:'student_reported'|'platform_verified';revision:number;updated_at:string;origin:'profile'|'group_memory'};
export type LearnerProfile={facts:ProfileFact[];courses:{id:string;code:string;title:string}[]};
const choices:Partial<Record<ProfileField,readonly string[]>>={answer_length:['short','standard','detailed'],explanation_style:['steps','examples','summary'],language:['en','es']};

function requireEnabled(){if(!learnerProfileEnabled())throw new BetaHttpError('Not found',404);}

async function facts(c:PoolClient,user:string,courses?:string[]){
 const own=(await c.query('SELECT id,field,course_id,value,authority,revision,updated_at FROM schoolvault.learner_profile_facts WHERE user_id=$1 AND ($2::uuid[] IS NULL OR course_id IS NULL OR course_id=ANY($2::uuid[])) ORDER BY field,course_id NULLS FIRST,authority',[user,courses??null])).rows.map(r=>({...r,origin:'profile'}));
 const groups=(await c.query("SELECT id,course_id,body,revision,updated_at FROM schoolvault.student_memory WHERE user_id=$1 AND kind='correction' AND chat_id IS NULL AND course_id IS NOT NULL AND ($2::uuid[] IS NULL OR course_id=ANY($2::uuid[]))",[user,courses??null])).rows
  .flatMap(r=>{const g=parseGroupReport(r.body);return g?[{id:r.id,field:'section',course_id:r.course_id,value:g.name,authority:'student_reported',revision:r.revision,updated_at:r.updated_at,origin:'group_memory'}]:[];});
 return [...own,...groups] as ProfileFact[];
}

export async function getLearnerProfile(user:string):Promise<LearnerProfile>{
 requireEnabled();
 return tenant(user,async c=>({facts:await facts(c,user),courses:(await c.query('SELECT id,code,title FROM schoolvault.courses WHERE user_id=$1 ORDER BY code',[user])).rows}),{readOnlySnapshot:true});
}

function valid(input:any){
 if(!profileFields.includes(input?.field))throw new BetaHttpError('Choose a profile field.');
 const value=typeof input.value==='string'?input.value.trim().replace(/\s+/g,' '):'';
 if(!value||value.length>400||/[\x00-\x1f\x7f\[\]<>`]/.test(value))throw new BetaHttpError('Enter a short value (up to 400 characters).');
 const allowed=choices[input.field as ProfileField];if(allowed&&!allowed.includes(value))throw new BetaHttpError('Choose one of the offered values.');
 if((input.field==='section')!==(input.course_id!=null)||input.course_id!=null&&!uuid(input.course_id))throw new BetaHttpError('A section belongs to one course; other fields belong to your account.');
 if(input.id!=null&&(!uuid(input.id)||!Number.isSafeInteger(input.revision)||input.revision<1))throw new BetaHttpError('Invalid profile revision.');
 return {field:input.field as ProfileField,value,course_id:input.course_id??null};
}

export async function saveLearnerProfileFact(user:string,input:any){
 requireEnabled();const f=valid(input);
 return tenant(user,async c=>{
  if(f.course_id&&!(await c.query('SELECT 1 FROM schoolvault.courses WHERE user_id=$1 AND id=$2',[user,f.course_id])).rowCount)throw Error('Course not found');
  // The browser can only write student-reported values.
  const old=(await c.query("SELECT id,revision FROM schoolvault.learner_profile_facts WHERE user_id=$1 AND field=$2 AND course_id IS NOT DISTINCT FROM $3 AND authority='student_reported' FOR UPDATE",[user,f.field,f.course_id])).rows[0];
  if(old&&(input.id!==old.id||input.revision!==old.revision))throw new BetaConflict('This profile field changed elsewhere. Reload it; your edit is kept.');
  if(!old&&input.id)throw new BetaConflict('This profile field was removed elsewhere. Reload it; your edit is kept.');
  const row=old
   ?(await c.query("UPDATE schoolvault.learner_profile_facts SET value=$3,revision=revision+1,updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING id,field,course_id,value,authority,revision,updated_at",[user,old.id,f.value])).rows[0]
   :(await c.query("INSERT INTO schoolvault.learner_profile_facts(user_id,id,field,course_id,value,authority) VALUES($1,$2,$3,$4,$5,'student_reported') RETURNING id,field,course_id,value,authority,revision,updated_at",[user,randomUUID(),f.field,f.course_id,f.value])).rows[0];
  await c.query('INSERT INTO schoolvault.audit(user_id,id,action,target,details) VALUES($1,$2,$3,$4,$5)',[user,randomUUID(),'learner-profile-save',row.id,JSON.stringify({field:f.field,course_id:f.course_id,authority:'student_reported',revision:row.revision})]);
  return {...row,origin:'profile'} as ProfileFact;
 });
}

export async function forgetLearnerProfileFact(user:string,id:unknown,revision:unknown){
 requireEnabled();
 if(!uuid(id)||!Number.isSafeInteger(revision))throw new BetaHttpError('Invalid profile revision.');
 return tenant(user,async c=>{
  const old=(await c.query("SELECT revision FROM schoolvault.learner_profile_facts WHERE user_id=$1 AND id=$2 AND authority='student_reported' FOR UPDATE",[user,id])).rows[0];
  if(!old)throw Error('Profile field not found');
  if(old.revision!==revision)throw new BetaConflict('This profile field changed elsewhere. Reload it before removing it.');
  await c.query('DELETE FROM schoolvault.learner_profile_facts WHERE user_id=$1 AND id=$2',[user,id]);
  return {forgotten:true};
 });
}

// Worker view: sections per course and account preferences, each with its authority.
export async function learnerProfileProjection(c:PoolClient,user:string,courses:string[]){
 const rows=await facts(c,user,courses);
 return {
  sections:rows.filter(r=>r.field==='section').map(r=>({course_id:r.course_id,name:r.value,authority:r.authority,origin:r.origin})),
  preferences:Object.fromEntries(rows.filter(r=>r.field!=='section').map(r=>[r.field,{value:r.value,authority:r.authority}])),
 };
}
