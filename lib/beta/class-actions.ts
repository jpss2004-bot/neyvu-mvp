import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {tenant,uuid,betaPool} from './db';
import {lockVault,checkObjects,checkHistory,HistoryLimit} from './budget';
import {BetaHttpError} from './http';
import {currentCourseSelection} from './course-selection';
import {digest} from './class-recording-format';
import {classActionAlgorithm,classActionCandidates} from './class-actions-format';
import {speechShouldYield} from './class-transcription';

export const classActionsEnabled=()=>process.env.SCHOOL_BETA_CLASS_CAPTURE==='1'&&process.env.SCHOOL_BETA_CLASS_ACTIONS==='1';
async function eligible(c:PoolClient,user:string,course:string){const selection=await currentCourseSelection(c,user),row=(await c.query('SELECT moodle_id FROM schoolvault.courses WHERE user_id=$1 AND id=$2',[user,course])).rows[0];return !!row&&(!row.moodle_id||selection.confirmed&&selection.moodle_ids.includes(row.moodle_id));}

function association(quote:string,sources:any[]){
 const exact=sources.filter(s=>quote.includes(s.original_url));
 const name=/\b(assignment|quiz|lab|report|worksheet|exercise|case|project)\s*#?\s*(\d{1,3})\b/i.exec(quote);
 const candidates=exact.length?exact:name?sources.filter(s=>new RegExp('\\b'+name[1]+'\\s*#?\\s*'+name[2]+'\\b','i').test(s.title)):[];
 if(candidates.length!==1)return {activity:null,activity_gap:candidates.length>1?'Several saved activities match the spoken name; choose the correct activity in Moodle.':'No unique saved Moodle activity is linked. Class instructions may describe separate reading, practice or in-class work.'};
 const s=candidates[0];return {activity:{source_id:s.id,version_id:s.current_version,title:s.title,original_url:s.original_url,basis:exact.length?'exact_url':'unique_spoken_name_candidate',verified:false},activity_gap:exact.length?null:'The spoken name has one candidate match; confirm it is the same work.'};
}

// Call only with the vault lock held. A failed enrichment rolls back its own
// savepoint, so it cannot erase the durable transcript it is derived from.
export async function reconcileClassActions(c:PoolClient,user:string,id:string){
 if(!classActionsEnabled())return;
 const s=(await c.query('SELECT * FROM schoolvault.class_sessions WHERE user_id=$1 AND id=$2',[user,id])).rows[0];if(!s?.current_transcript)return;
 if(!(await eligible(c,user,s.course_id))){await c.query("UPDATE schoolvault.class_sessions SET actions_state='paused' WHERE user_id=$1 AND id=$2",[user,id]);return;}
 const t=(await c.query('SELECT * FROM schoolvault.class_transcripts WHERE user_id=$1 AND session_id=$2 AND id=$3',[user,id,s.current_transcript])).rows[0];if(!t)throw Error('Class transcript missing');
 await c.query('SAVEPOINT class_actions_enrichment');
 try{
  const discovery=classActionCandidates(t.segments,s.recorded_at,s.timezone),existing=(await c.query("SELECT * FROM schoolvault.student_plans WHERE user_id=$1 AND kind='class_action' AND class_evidence->>'session_id'=$2 FOR UPDATE",[user,id])).rows;
  const sources=(await c.query("SELECT id,current_version,title,original_url FROM schoolvault.sources WHERE user_id=$1 AND course_id=$2 AND kind='moodle' AND original_url ~ '^https://moodle[.]acadiau[.]ca/mod/(assign|quiz|forum|workshop)/view[.]php[?]id=[1-9][0-9]*$' ORDER BY id",[user,s.course_id])).rows;
  let changed=false;
  const store=async(old:any,evidence:any,candidate?:any)=>{
   const binding=digest(JSON.stringify(evidence));evidence={...evidence,binding};if(old?.class_evidence?.binding===binding)return;
   const plan=old?.id||randomUUID();
   if(!old){await checkObjects(c,user,'student_plans');await c.query("INSERT INTO schoolvault.student_plans(user_id,id,course_id,kind,title,next_action,state,source_id,version_id,request_id,class_evidence) VALUES($1,$2,$3,'class_action',$4,'','not_started',$5,$6,$7,$8)",[user,plan,s.course_id,candidate.title,t.source_id,t.version_id,randomUUID(),evidence]);}
   else await c.query('UPDATE schoolvault.student_plans SET source_id=$3,version_id=$4,class_evidence=$5,revision=revision+1,updated_at=now() WHERE user_id=$1 AND id=$2',[user,plan,t.source_id,t.version_id,evidence]);
   await c.query('INSERT INTO schoolvault.class_action_revisions(user_id,id,plan_id,binding,evidence) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,plan_id,binding) DO NOTHING',[user,randomUUID(),plan,binding,evidence]);changed=true;
  };
  for(const candidate of discovery.items){const old=existing.find(p=>p.class_evidence.key===candidate.key);await store(old,{algorithm:classActionAlgorithm,session_id:id,transcript_id:t.id,source_id:t.source_id,version_id:t.version_id,recorded_at:s.recorded_at.toISOString(),timezone:s.timezone,status:'current',speaker:'unidentified',authority:'class_recording',...candidate,...association(candidate.quote,sources)},candidate);}
  for(const old of existing.filter(p=>!discovery.observed_keys.includes(p.class_evidence.key))){const {binding,...prior}=old.class_evidence;await store(old,{...prior,status:'withdrawn',withdrawn_in_transcript_id:t.id,withdrawal_reason:'The current corrected transcript does not contain this supported instruction. Your personal work is kept.'});}
  await c.query("UPDATE schoolvault.class_sessions SET actions_state='prepared',actions_summary=$3 WHERE user_id=$1 AND id=$2",[user,id,{algorithm:classActionAlgorithm,state:'prepared',transcript_id:t.id,candidates:discovery.items.length,complete:false,limitations:discovery.limitations}]);
  if(changed)await c.query("UPDATE schoolvault.jobs SET status='cancelled',error='Class instructions changed. Your question is kept; ask again for current class actions.',lease_hash=NULL,lease_until=NULL,updated_at=now() WHERE user_id=$1 AND kind='answer' AND status='leased' AND input ? 'work'",[user]);
  await checkHistory(c,user);await c.query('RELEASE SAVEPOINT class_actions_enrichment');
 }catch(error){await c.query('ROLLBACK TO SAVEPOINT class_actions_enrichment');await c.query('RELEASE SAVEPOINT class_actions_enrichment');if(!(error instanceof HistoryLimit||error instanceof Error&&error.message.startsWith('Invalid text:')))throw error;
  await c.query("UPDATE schoolvault.class_sessions SET actions_state='held' WHERE user_id=$1 AND id=$2",[user,id]);
  await c.query('SAVEPOINT class_actions_notice');try{await c.query('UPDATE schoolvault.class_sessions SET actions_summary=$3 WHERE user_id=$1 AND id=$2',[user,id,{algorithm:classActionAlgorithm,state:'held',transcript_id:t.id,complete:false,error:'Class actions reached the vault limit. Audio, transcript and prior personal work are kept. Export work before retrying.',limitations:['Action enrichment did not finish; check the full transcript for work.']}]);await checkHistory(c,user);}catch(noticeError){await c.query('ROLLBACK TO SAVEPOINT class_actions_notice');if(!(noticeError instanceof HistoryLimit))throw noticeError;}finally{await c.query('RELEASE SAVEPOINT class_actions_notice');}
 }
}

export async function prepareClassActions(user:string,id:string){
 if(!classActionsEnabled())throw new BetaHttpError('Class actions are not available yet.',503);if(!uuid(id))throw new BetaHttpError('Choose a class recording.');
 return tenant(user,async c=>{await lockVault(c,user);if(!(await c.query('SELECT 1 FROM schoolvault.users WHERE id=$1 AND disabled_at IS NULL',[user])).rowCount)throw new BetaHttpError('Account unavailable.',403);const s=(await c.query('SELECT * FROM schoolvault.class_sessions WHERE user_id=$1 AND id=$2',[user,id])).rows[0];if(!s)throw new BetaHttpError('Class not found.',404);if(!s.current_transcript)throw new BetaHttpError('Prepare and review its transcript first.');await reconcileClassActions(c,user,id);return classActionSummary((await c.query('SELECT current_transcript,actions_summary,actions_state FROM schoolvault.class_sessions WHERE user_id=$1 AND id=$2',[user,id])).rows[0]);});
}

export function classActionSummary(record:any){const summary=record.actions_summary;if(!classActionsEnabled()&&!summary)return null;if(record.actions_state==='held')return {state:'held',transcript_id:record.current_transcript,complete:false,error:'Class actions reached the vault limit. Audio, transcript and prior personal work are kept. Export work before retrying.',limitations:['Action enrichment did not finish; check the full transcript for work.']};if(record.actions_state==='paused')return {state:'paused',transcript_id:record.current_transcript,complete:false,limitations:['Choose this course as current to prepare its actions.']};return record.current_transcript&&(summary?.transcript_id!==record.current_transcript||summary?.algorithm!==classActionAlgorithm)?{state:'not_prepared',transcript_id:record.current_transcript,complete:false,limitations:['Actions for the current transcript and reader are not prepared. Prior personal work is kept; refresh after checking vault capacity and current course selection.']}:summary;}

export async function processClassActions(){
 if(!classActionsEnabled())return null;
 if(await speechShouldYield())return null;
 for(const user of (await betaPool().query('SELECT id FROM schoolvault.users WHERE disabled_at IS NULL ORDER BY last_class_action_at NULLS FIRST,created_at,id')).rows){const processed=await tenant(user.id,async c=>{
  await lockVault(c,user.id);const selection=await currentCourseSelection(c,user.id);
  const s=(await c.query(`SELECT s.id FROM schoolvault.class_sessions s JOIN schoolvault.courses course ON course.user_id=s.user_id AND course.id=s.course_id WHERE s.user_id=$1 AND s.current_transcript IS NOT NULL AND s.actions_state!='held' AND (s.actions_summary IS NULL OR s.actions_summary->>'transcript_id' IS DISTINCT FROM s.current_transcript::text OR s.actions_summary->>'algorithm' IS DISTINCT FROM $4 OR s.actions_state='paused') AND (course.moodle_id IS NULL OR $2 AND course.moodle_id=ANY($3::text[])) ORDER BY s.recorded_at,s.id LIMIT 1`,[user.id,selection.confirmed,selection.moodle_ids,classActionAlgorithm])).rows[0];
  if(!s)return false;await reconcileClassActions(c,user.id,s.id);await c.query('UPDATE schoolvault.users SET last_class_action_at=now() WHERE id=$1',[user.id]);return true;
 });if(processed)return {processed:true};}return null;
}
