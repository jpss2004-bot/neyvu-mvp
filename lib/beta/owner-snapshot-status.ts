import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {AssessmentCapture,ReceiptView} from './moodle-receipts';
// Trusted only by the guarded local-owner importer. This does not manufacture a
// Companion identity, DOM classes, grade or signed_in_capture provenance.
export type OwnerSnapshotStatus={snapshot_sha256:string;observation_id:string;observed_at:string;url:string;course:string;notes_sha256:string;state:ReceiptView['state'];proof:AssessmentCapture;blocked:boolean};
const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
export function ownerSnapshotStatus(task:any,snapshotSha:string,gaps:any[]=[]):OwnerSnapshotStatus|null{
 if(task?.source_id!=='moodle'||task.authority!=='Moodle'||task.kind!=='task'||task.capture_method!=='independent_browser'||task.deleted||task.id!==task.url||typeof task.course!=='string'||!task.course||typeof task.notes!=='string'||task.notes.length>70000||!task.notes.trim()||!Number.isFinite(Date.parse(task.observed_at))||!/^[a-f0-9]{64}$/.test(task.observation_id||'')||!/^[a-f0-9]{64}$/.test(snapshotSha))return null;
 const match=String(task.url).match(/^https:\/\/moodle\.acadiau\.ca\/mod\/(assign|quiz)\/view\.php\?id=[1-9]\d{0,11}$/);if(!match)return null;
 const notes=task.notes,base={snapshot_sha256:snapshotSha,observation_id:task.observation_id,observed_at:new Date(task.observed_at).toISOString(),url:task.url,course:task.course,notes_sha256:sha(notes),blocked:gaps.some(g=>g.url===task.url)};
 if(match[1]==='assign'){
  const rows=[...notes.matchAll(/^Submission status\t([^\n]+)$/gm)];if(rows.length!==1||/^(?:Group|Members who need to submit|Members who have not submitted)\t/im.test(notes))return null;
  const value=rows[0][1].trim(),state=({'Submitted for grading':'submitted','Draft (not submitted)':'draft','No submission':'no_submission','No submissions have been made yet':'no_submission','Reopened':'reopened'} as const)[value];
  if(!state||task.submission_status!==value)return null;
  return {...base,state,proof:{kind:'assignment',layout:'owner-snapshot-status-row',rows:[{label:'Submission status',value,classes:[]}],attempts:[],truncated:false}};
 }
 const blocks=[...notes.matchAll(/^Attempt ([1-9]\d{0,5})\n(?:Attempt \1 summary\n)?Status\t([^\n]+)$/gm)];
 if(!blocks.length||blocks.length>20)return null;
 const attempts=blocks.map(m=>({number:m[1],state:m[2].trim()}));if(new Set(attempts.map(a=>a.number)).size!==attempts.length)return null;
 const latest=[...attempts].sort((a,b)=>Number(b.number)-Number(a.number))[0],state=({'Finished':'attempt_finished','In progress':'attempt_in_progress','Overdue':'attempt_overdue','Never submitted':'attempt_abandoned'} as const)[latest.state];
 if(!state||task.submission_status!==latest.state||!Array.isArray(task.attempt_statuses)||JSON.stringify(task.attempt_statuses)!==JSON.stringify(attempts.map(a=>a.state)))return null;
 return {...base,state,proof:{kind:'quiz',layout:'owner-snapshot-numbered-attempts',rows:[],attempts,truncated:false}};
}
export function ownerSnapshotReceipt(stored:OwnerSnapshotStatus,body:string,version:string,current:string,observed:string,url:string,course:string,now:Date):ReceiptView|null{
 // Reparse exact original text, rather than trust a stored state/proof alone.
 if(!stored||!stored.proof||!Array.isArray(stored.proof.rows)||!Array.isArray(stored.proof.attempts)||!['assignment','quiz'].includes(stored.proof.kind))return null;
 const marker='Original owner activity text:\n',at=body.indexOf(marker);if(at<0)return null;const notes=body.slice(at+marker.length);
 if(sha(notes)!==stored.notes_sha256||stored.url!==url||stored.course!==course||Date.parse(stored.observed_at)!==Date.parse(observed))return null;
 const task={source_id:'moodle',authority:'Moodle',kind:'task',capture_method:'independent_browser',id:url,url,course,notes,observation_id:stored.observation_id,observed_at:observed,submission_status:stored.proof.kind==='assignment'?stored.proof.rows[0]?.value:[...stored.proof.attempts].sort((a,b)=>Number(b.number)-Number(a.number))[0]?.state,attempt_statuses:stored.proof.attempts.map(a=>a.state)};
 const parsed=ownerSnapshotStatus(task,stored.snapshot_sha256);if(!parsed||parsed.state!==stored.state||!isDeepStrictEqual(parsed.proof,stored.proof))return null;
 const age=now.getTime()-Date.parse(stored.observed_at),eligible=version===current&&!stored.blocked&&age>=-60000&&age<=86400000;
 return {id:'owner-snapshot-'+stored.observation_id,state:eligible?stored.state:'unknown',observed_state:stored.state,eligible,observed_at:stored.observed_at,version_id:version,activity_url:url,proof:stored.proof,provenance:'owner_snapshot',reason:!eligible?'Saved owner snapshot status needs refresh. Check this receipt before repeating finished work.':'Observed in the owner’s primary Moodle browser capture and imported from its checksum-verified snapshot. This is saved owner-local evidence, not a live check or a Companion capture. Grades and other requirements remain separate.'};
}
