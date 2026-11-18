import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {tenant,uuid} from './db';
import {BetaHttpError} from './http';
import {lockVault,checkHistory} from './budget';
import {currentCourseSelection,saveCurrentCourseSelection} from './course-selection';

type Actor={user:string;device:string};
const key=(s:unknown)=>typeof s==='string'?s.match(/^moodle-user:([1-9]\d{0,11})(?:\s*·.*)?$/)?.[1]:undefined;
const action='moodle-assignment-check';
async function event(c:PoolClient,user:string,target:string,details:unknown,kind=action){
 await c.query('INSERT INTO schoolvault.audit(user_id,id,action,target,details,created_at) VALUES($1,$2,$3,$4,$5,clock_timestamp())',[user,randomUUID(),kind,target,JSON.stringify(details)]);
 await checkHistory(c,user);
}
async function device(c:PoolClient,a:Actor){
 const d=(await c.query('SELECT moodle_identity FROM schoolvault.companion_devices WHERE user_id=$1 AND id=$2 AND revoked_at IS NULL',[a.user,a.device])).rows[0];
 const pin=(await c.query("SELECT identity FROM schoolvault.connectors WHERE user_id=$1 AND provider='moodle' AND revoked_at IS NULL",[a.user])).rows[0];
 if(!d||!key(d.moodle_identity)||key(d.moodle_identity)!==key(pin?.identity))throw new BetaHttpError('Reconnect the original Moodle account.',409);
 return key(d.moodle_identity)!;
}
export function validateActiveLabs(raw:any){
 if(!raw||!uuid(raw.expected_revision)||!key(raw.identity)||raw.grouping!=='inprogress'||raw.complete!==true||!Array.isArray(raw.labs)||!raw.labs.length||raw.labs.length>40||raw.labs.some((l:any)=>!l||typeof l.id!=='string'||! /^[1-9]\d{0,11}$/.test(l.id)||typeof l.category!=='string'||! /^(labs?|laborator(y|ies))$/i.test(l.category))||new Set(raw.labs.map((l:any)=>l.id)).size!==raw.labs.length)throw new BetaHttpError('New labs need explicit active Moodle category evidence.');
 const captured=Date.parse(raw.captured_at);
 if(typeof raw.captured_at!=='string'||!Number.isFinite(captured)||captured>Date.now()+60000||captured<Date.now()-86400000)throw new BetaHttpError('Check the active lab list again.');
 return raw as {identity:string;expected_revision:string;captured_at:string;labs:{id:string;category:string}[]};
}
export async function addActiveLabs(a:Actor,raw:unknown){
 const proof=validateActiveLabs(raw);
 return tenant(a.user,async c=>{
  await lockVault(c,a.user);const identity=await device(c,a);
  if(identity!==key(proof.identity))throw new BetaHttpError('The Moodle account changed.',409);
  const current=await currentCourseSelection(c,a.user);
  const previous=(await c.query("SELECT details FROM schoolvault.audit WHERE user_id=$1 AND action='moodle-active-labs-added' AND target=$2 ORDER BY created_at DESC,id DESC LIMIT 1",[a.user,a.device])).rows[0]?.details;
  if(previous?.expected_revision===proof.expected_revision&&previous?.captured_at===proof.captured_at&&JSON.stringify(previous.labs)===JSON.stringify(proof.labs)&&previous.revision===current.revision)return {saved:true,current_courses:current};
  if(!current.confirmed||current.revision!==proof.expected_revision)throw new BetaHttpError('Your course selection changed. Review it before adding labs.',409);
  const ids=[...new Set([...current.moodle_ids,...proof.labs.map(l=>l.id)])];
  if(ids.length>40||ids.length===current.moodle_ids.length)throw new BetaHttpError('Review the new labs before importing.');
  const next=await saveCurrentCourseSelection(c,a.user,a.device,{identity:proof.identity,identity_key:identity,moodle_ids:ids.sort((a,b)=>a.localeCompare(b,'en',{numeric:true})),reviewed_at:new Date(Math.max(Date.now(),Date.parse(current.reviewed_at!)+1)).toISOString(),selection_source:'moodle-inprogress',expected_revision:current.revision});
  await event(c,a.user,a.device,{...proof,revision:next.revision},'moodle-active-labs-added');
  return {saved:true,current_courses:next};
 });
}
async function latest(c:PoolClient,user:string){
 return (await c.query(`SELECT DISTINCT ON(target) target,details,created_at FROM schoolvault.audit WHERE user_id=$1 AND action=$2 ORDER BY target,created_at DESC,id DESC`,[user,action])).rows;
}
async function assignment(c:PoolClient,user:string,source:string){
 const row=(await c.query('SELECT s.id,s.original_url AS url,s.title,c.moodle_id AS course_id,c.title AS course_title FROM schoolvault.sources s JOIN schoolvault.courses c ON c.user_id=s.user_id AND c.id=s.course_id WHERE s.user_id=$1 AND s.id=$2 AND s.kind=\'moodle\'',[user,source])).rows[0];
 if(!row||!/^https:\/\/moodle\.acadiau\.ca\/mod\/assign\/view\.php\?id=[1-9]\d{0,11}$/.test(row.url||''))throw new BetaHttpError('Choose a saved Moodle assignment.',404);
 const selected=await currentCourseSelection(c,user);
 if(!selected.confirmed||!selected.moodle_ids.includes(row.course_id))throw new BetaHttpError('This assignment is outside your current courses.',409);
 return {row,selected};
}
export async function requestAssignmentCheck(user:string,source:unknown){
 if(!uuid(source))throw new BetaHttpError('Choose a saved assignment.');
 return tenant(user,async c=>{
  await lockVault(c,user);const {row,selected}=await assignment(c,user,source);
  const identity=(await c.query("SELECT identity FROM schoolvault.connectors WHERE user_id=$1 AND provider='moodle' AND revoked_at IS NULL",[user])).rows[0]?.identity;
  if(!key(identity))throw new BetaHttpError('Connect Moodle before requesting a live check.',409);
  const rows=await latest(c,user),now=Date.now();
  const pending=rows.filter(r=>['queued','checking'].includes(r.details.state)&&Date.parse(r.details.expires_at)>now);
  const existing=pending.find(r=>r.details.source_id===source&&r.details.revision===selected.revision&&r.details.identity_key===key(identity));
  if(existing)return {check:{id:existing.target,...existing.details}};
  if(pending.length>=20)throw new BetaHttpError('Twenty assignment checks are already waiting. Let Companion finish them first.',429);
  const id=randomUUID(),details={state:'queued',source_id:source,url:row.url,course_id:row.course_id,course_title:row.course_title,identity_key:key(identity),revision:selected.revision,requested_at:new Date(now).toISOString(),expires_at:new Date(now+86400000).toISOString()};
  await event(c,user,id,details);return {check:{id,...details}};
 });
}
export async function assignmentCheckStatus(user:string,source:unknown){
 if(!uuid(source))throw new BetaHttpError('Choose a saved assignment.');
 return tenant(user,async c=>{
  await assignment(c,user,source);
  const row=(await latest(c,user)).filter(r=>r.details.source_id===source).sort((a,b)=>Date.parse(b.details.requested_at)-Date.parse(a.details.requested_at))[0];
  if(!row)return {check:null};
  const d=row.details,state=['queued','checking'].includes(d.state)&&Date.parse(d.expires_at)<=Date.now()?'expired':d.state;
  return {check:{id:row.target,state,source_id:source,requested_at:d.requested_at,completed_at:d.completed_at||null}};
 });
}
export async function claimAssignmentCheck(a:Actor){
 return tenant(a.user,async c=>{
  await lockVault(c,a.user);const identity=await device(c,a),selection=await currentCourseSelection(c,a.user),now=Date.now();
  const rows=(await latest(c,a.user)).sort((a,b)=>Date.parse(a.details.requested_at)-Date.parse(b.details.requested_at));
  for(const row of rows){
   const d=row.details;if(!['queued','checking'].includes(d.state))continue;
   if(d.state==='checking'&&Date.parse(d.lease_until)>now)continue;
   if(Date.parse(d.expires_at)<=now||d.identity_key!==identity||d.revision!==selection.revision||!selection.moodle_ids.includes(d.course_id)){await event(c,a.user,row.target,{...d,state:'expired'});continue;}
   await assignment(c,a.user,d.source_id);
   const details={...d,state:'checking',device:a.device,lease:randomUUID(),claimed_at:new Date(now).toISOString(),lease_until:new Date(now+120000).toISOString()};
   await event(c,a.user,row.target,details);return {check:{id:row.target,...details}};
  }
  return {check:null};
 });
}
export async function finishAssignmentCheck(a:Actor,raw:any){
 if(!uuid(raw?.id)||!uuid(raw?.lease))throw new BetaHttpError('Invalid assignment check acknowledgement.');
 return tenant(a.user,async c=>{
  await lockVault(c,a.user);const identity=await device(c,a),row=(await latest(c,a.user)).find(r=>r.target===raw.id),d=row?.details;
  if(!d||d.device!==a.device||d.lease!==raw.lease||d.identity_key!==identity)throw new BetaHttpError('Assignment check lease changed.',409);
  const {selected}=await assignment(c,a.user,d.source_id);
  if(d.revision!==selected.revision)throw new BetaHttpError('Course selection changed during this check.',409);
  if(d.state==='complete')return {saved:true};
  if(d.state!=='checking'||Date.parse(d.lease_until)<=Date.now())throw new BetaHttpError('Assignment check lease expired.',409);
  const proof=(await c.query('SELECT captured_at,received_at,device_id FROM schoolvault.moodle_observations WHERE user_id=$1 AND source_id=$2',[a.user,d.source_id])).rows[0];
  if(!proof||proof.device_id!==a.device||new Date(proof.captured_at).getTime()<Date.parse(d.claimed_at)||new Date(proof.received_at).getTime()<Date.parse(d.claimed_at))throw new BetaHttpError('The fresh assignment page has not been saved yet.',409);
  await event(c,a.user,raw.id,{...d,state:'complete',completed_at:new Date().toISOString()});return {saved:true};
 });
}
