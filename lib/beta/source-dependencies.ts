import type {PoolClient} from 'pg';
import {uuid} from './db';
export type ChangedSource={id:string;title:string;course_id:string;kind:string;version_id:string;current_version:string};
// Call in the same vault-locked transaction that replaces the current version.
export async function sourceChanged(c:PoolClient,user:string,id:string,version:string){
 await c.query(`UPDATE schoolvault.source_profiles p SET state='stale',updated_at=now() FROM schoolvault.jobs j
 WHERE p.user_id=$1 AND p.source_id=$2 AND p.version_id!=$3 AND p.state IN('queued','reading')
 AND j.user_id=p.user_id AND j.kind='summary' AND j.input->>'task'='source-profile-v1'
 AND j.input->>'version_id'=p.version_id::text AND coalesce(j.input->>'historical','false')!='true'`,[user,id,version]);
 await c.query(`UPDATE schoolvault.jobs SET status='cancelled',error='The source changed. Read the current version for current advice.',lease_hash=NULL,lease_until=NULL,updated_at=now()
 WHERE user_id=$1 AND kind='summary' AND status IN('queued','leased') AND input->>'task'='source-profile-v1'
 AND input->>'source_id'=$2 AND input->>'version_id'!=$3 AND coalesce(input->>'historical','false')!='true'`,[user,id,version]);
 await c.query(`UPDATE schoolvault.jobs SET status='cancelled',error='Class speech or course material changed. Accepted notes are kept; prepare a new draft.',lease_hash=NULL,lease_until=NULL,updated_at=now() WHERE user_id=$1 AND kind='summary' AND input->>'task'='class-cornell-v1' AND status IN('queued','leased') AND EXISTS(SELECT 1 FROM jsonb_array_elements(input->'sources') ref WHERE ref->>'id'=$2 AND ref->>'current_at_queue'!=$3)`,[user,id,version]);
 await c.query(`UPDATE schoolvault.jobs j SET status='cancelled',error='A source changed while this answer was being prepared. Your question is saved; ask again to use the new version.',lease_hash=NULL,lease_until=NULL,updated_at=now()
 WHERE j.user_id=$1 AND j.kind='answer' AND j.status='leased' AND EXISTS(
 SELECT 1 FROM jsonb_array_elements(coalesce(j.input->'sources','[]')) ref
 WHERE ref->>'id'=$2 AND ref->>'version_id'!=$3
 AND (j.input->'context_versions'->>$2) IS DISTINCT FROM (ref->>'version_id'))`,[user,id,version]);
}
// Evidence may change repeatedly. Derive current status when reading, rather
// than rewriting historical answers or guessing which assertion was affected.
export async function changedSources(c:PoolClient,user:string,refs:any[]):Promise<ChangedSource[]>{
 const pairs=[...new Map(refs.filter(r=>uuid(r?.id)&&uuid(r?.version_id)).map(r=>[r.id+':'+r.version_id,{id:r.id,version:r.version_id}])).values()];
 if(!pairs.length)return [];
 return (await c.query(`SELECT s.id,s.title,s.course_id,s.kind,v.id AS version_id,s.current_version
 FROM jsonb_to_recordset($2::jsonb) ref(id uuid,version uuid)
 JOIN schoolvault.sources s ON s.user_id=$1 AND s.id=ref.id
 JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.source_id=s.id AND v.id=ref.version
 WHERE s.current_version!=v.id ORDER BY s.title,s.id,v.id`,[user,JSON.stringify(pairs)])).rows;
}
export async function noteChanges(c:PoolClient,user:string,notes:any[]){
 const ids=notes.filter(n=>n.origin==='ai_draft').map(n=>n.id);if(!ids.length)return;
 const jobs=(await c.query(`SELECT result->>'study_note_id' AS note_id,result->'study_note_ids' AS note_ids,coalesce(result->'dependencies',input->'sources') AS sources FROM schoolvault.jobs
 WHERE user_id=$1 AND (kind='answer' OR kind='summary' AND input->>'task'='class-cornell-v1') AND status='complete' AND (result->>'study_note_id'=ANY($2::text[]) OR coalesce(result->'study_note_ids','[]'::jsonb) ?| $2::text[])`,[user,ids])).rows;
 const refs=jobs.flatMap(j=>j.sources||[]),changed=await changedSources(c,user,refs);
 for(const n of notes){const job=jobs.find(j=>j.note_id===n.id||j.note_ids?.includes(n.id));if(job)n.changed_sources=changed.filter(r=>(job.sources||[]).some((s:any)=>s.id===r.id&&s.version_id===r.version_id));}
}
