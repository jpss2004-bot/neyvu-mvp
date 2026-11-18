import {cancelCourseGroupAnswers} from './group-answer-invalidation';
import {parseGroupReport} from './group-context-format';
import {parseAvailability} from './availability-format';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {tenant,uuid} from './db';
import {lockVault,checkHistory,checkObjects} from './budget';
import {BetaConflict} from './vault';
import {BetaHttpError} from './http';

export const memoryKinds=['choice','correction','preference','progress','availability'] as const;
export type MemoryKind=typeof memoryKinds[number];
export type StudentMemory={id:string;course_id:string|null;chat_id:string|null;kind:MemoryKind;body:string;revision:number;updated_at:string};
const fields='id,course_id,chat_id,kind,body,revision,updated_at';
async function scope(c:PoolClient,user:string,chatId:unknown,courseId:unknown){
 if(chatId!=null&&!uuid(chatId)||courseId!=null&&!uuid(courseId))throw new BetaHttpError('Choose a saved chat or course.');
 const chat=chatId?(await c.query('SELECT course_id,archived FROM schoolvault.chats WHERE user_id=$1 AND id=$2',[user,chatId])).rows[0]:null;
 if(chatId&&(!chat||chat.archived))throw Error('Chat not found');
 if(courseId&&!(await c.query('SELECT id FROM schoolvault.courses WHERE user_id=$1 AND id=$2',[user,courseId])).rowCount)throw Error('Course not found');
 // A chat-specific choice stays with its course when the chat changes courses.
 if(chatId&&courseId!==chat.course_id)throw new BetaConflict('This chat changed courses. Reload your memories before saving.');
 return {chat_id:chatId??null,course_id:courseId??null};
}
export async function listStudentMemory(user:string,chatId:unknown,courseId:unknown){return tenant(user,async c=>{
 const chosen=await scope(c,user,chatId,courseId);
 return (await c.query(`SELECT ${fields} FROM schoolvault.student_memory WHERE user_id=$1 AND (course_id IS NULL AND chat_id IS NULL OR chat_id=$2 AND course_id IS NOT DISTINCT FROM $3::uuid OR chat_id IS NULL AND course_id=$3) ORDER BY updated_at DESC,id DESC LIMIT 100`,[user,chosen.chat_id,chosen.course_id])).rows as StudentMemory[];
});}
function validText(kind:unknown,body:unknown){
 if(!memoryKinds.includes(kind as MemoryKind)||typeof body!=='string'||!body.trim()||body.trim().length>1600)throw new BetaHttpError('Enter a choice, correction, preference or progress note (up to 1,600 characters).');
 if(kind==='availability'){try{parseAvailability(body);}catch{throw new BetaHttpError('Enter a valid recurring study schedule.');}}
 return body.trim();
}
async function cancelOldAnswers(c:PoolClient,user:string,id:string){
 await c.query(`UPDATE schoolvault.jobs SET status='cancelled',error='A saved memory changed. Your question is kept; ask again to use the updated context.',lease_hash=NULL,lease_until=NULL,updated_at=now() WHERE user_id=$1 AND kind='answer' AND status='leased' AND (input->'student_context'->'memories' @> $2::jsonb OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(input->'work'->'tasks','[]'::jsonb)) task WHERE task->'personal_report'->>'memory_id'=$3))`,[user,JSON.stringify([{id}]),id]);
}

// `provenance` records why a group report was saved (for example a chat
// clarification choice) in the same transaction as the memory itself.
export type MemoryProvenance={action:'group-clarification-choice';target:string;details:Record<string,unknown>};
const recordProvenance=async(c:PoolClient,user:string,row:StudentMemory,provenance?:MemoryProvenance)=>{if(provenance)await c.query('INSERT INTO schoolvault.audit(user_id,id,action,target,details) VALUES($1,$2,$3,$4,$5)',[user,randomUUID(),provenance.action,provenance.target,JSON.stringify({...provenance.details,memory_id:row.id,memory_revision:row.revision})]);};
export async function saveStudentMemory(user:string,input:any,provenance?:MemoryProvenance){
 const body=validText(input.kind,input.body),group=parseGroupReport(body);
 if(provenance&&!group)throw new BetaHttpError('Only a course group report can carry clarification provenance.');
 if(group&&(input.kind!=='correction'||!uuid(input.course_id)||input.chat_id!=null))throw new BetaHttpError('Save a group correction for one course, across its chats.');
 if(input.kind==='availability'&&(input.course_id!=null||input.chat_id!=null))throw new BetaHttpError('Study availability belongs to your account, not one course.');
 if(input.request_id!=null&&!uuid(input.request_id))throw new BetaHttpError('Invalid memory request.');
 if(input.id!=null&&!uuid(input.id)||input.id!=null&&(!Number.isSafeInteger(input.revision)||input.revision<1))throw new BetaHttpError('Invalid memory revision.');
 return tenant(user,async c=>{
  await lockVault(c,user);
  const chosen=await scope(c,user,input.chat_id,input.course_id);
  if(group){
   const existing=(await c.query("SELECT id,request_id FROM schoolvault.student_memory WHERE user_id=$1 AND course_id=$2 AND chat_id IS NULL AND kind='correction' AND starts_with(body,$3) FOR UPDATE",[user,chosen.course_id,'Student-reported '+group.kind+': '])).rows;
   if(existing.some(row=>row.id!==input.id&&row.request_id!==input.request_id))throw new BetaConflict('This course group changed elsewhere. Reload it before saving.');
  }
  if(input.id){
   const old=(await c.query('SELECT '+fields+',request_id FROM schoolvault.student_memory WHERE user_id=$1 AND id=$2 FOR UPDATE',[user,input.id])).rows[0];
   if(!old)throw Error('Memory not found');
   if(input.request_id&&old.revision===input.revision+1&&old.body===body&&old.kind===input.kind&&old.course_id===chosen.course_id&&old.chat_id===chosen.chat_id)return old as StudentMemory;
   if(old.revision!==input.revision)throw new BetaConflict('This memory changed elsewhere. Reload it; your edit is kept.');
   const row=(await c.query(`UPDATE schoolvault.student_memory SET body=$3,kind=$4,course_id=$5,chat_id=$6,revision=revision+1,updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING ${fields}`,[user,input.id,body,input.kind,chosen.course_id,chosen.chat_id])).rows[0];
   await recordProvenance(c,user,row,provenance);
   if(group)await cancelCourseGroupAnswers(c,user,String(chosen.course_id));await cancelOldAnswers(c,user,input.id);await checkHistory(c,user);return row as StudentMemory;
  }
  if(input.request_id){
   const old=(await c.query(`SELECT ${fields} FROM schoolvault.student_memory WHERE user_id=$1 AND request_id=$2`,[user,input.request_id])).rows[0];
   if(old){if(old.body!==body||old.kind!==input.kind||old.course_id!==chosen.course_id||old.chat_id!==chosen.chat_id)throw new BetaConflict('This save was already received. Reload your memories before changing it.');return old as StudentMemory;}
  }
  await checkObjects(c,user,'student_memory');
  const row=(await c.query(`INSERT INTO schoolvault.student_memory(user_id,id,body,kind,course_id,chat_id,request_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING ${fields}`,[user,randomUUID(),body,input.kind,chosen.course_id,chosen.chat_id,input.request_id??randomUUID()])).rows[0];
  await recordProvenance(c,user,row,provenance);
  if(group)await cancelCourseGroupAnswers(c,user,String(chosen.course_id));await checkHistory(c,user);return row as StudentMemory;
 });
}
export async function forgetStudentMemory(user:string,id:unknown,revision:unknown){
 if(!uuid(id)||!Number.isSafeInteger(revision)||Number(revision)<1)throw new BetaHttpError('Invalid memory revision.');
 return tenant(user,async c=>{
  await lockVault(c,user);
  const old=(await c.query('SELECT revision,body,course_id FROM schoolvault.student_memory WHERE user_id=$1 AND id=$2 FOR UPDATE',[user,id])).rows[0];
  if(!old)throw Error('Memory not found');
  if(old.revision!==revision)throw new BetaConflict('This memory changed elsewhere. Reload it before forgetting.');
  await c.query('DELETE FROM schoolvault.student_memory WHERE user_id=$1 AND id=$2',[user,id]);
  if(old.course_id&&parseGroupReport(old.body))await cancelCourseGroupAnswers(c,user,old.course_id);await cancelOldAnswers(c,user,id);return {forgotten:true};
 });
}
