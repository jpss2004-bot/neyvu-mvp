import {savedPurposes} from './saved-purposes';
import {createHash} from 'node:crypto';
import {tenant} from './db';
import {id} from './vault';
import {feedbackActivity,wordComments} from './returned-feedback';
import {revisionComparison} from './revision-comparison';
import {feedbackPassages,type FeedbackContext} from './feedback-review';
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
export async function betaFeedbackContext(user:string,messageId:string):Promise<FeedbackContext>{
 return tenant(user,async c=>{
  const row=(await c.query("SELECT m.chat_id,m.content,m.sources,j.input FROM schoolvault.messages m JOIN schoolvault.jobs j ON j.user_id=m.user_id AND j.id::text=m.content->>'job_id' AND j.chat_id=m.chat_id WHERE m.user_id=$1 AND m.id=$2 AND m.role='assistant' AND m.content->>'type'='answer' AND j.status='complete'",[user,id(messageId)])).rows[0];
  if(!row)throw Error('Saved feedback answer not found');
  const feedback:FeedbackContext['feedback']=[];
  for(const ref of (row.sources||[]).slice(0,30)){
   const packet=ref.returned_feedback;if(packet?.format!==1||packet.version_id!==ref.version_id||ref.untrusted||!ref.course_id||row.input.course_id&&ref.course_id!==row.input.course_id)continue;
   const original=(await c.query("SELECT s.id,s.title,s.kind,s.course_id,s.current_version,v.id AS version_id,v.body FROM schoolvault.sources s JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.source_id=s.id AND v.id=$3 WHERE s.user_id=$1 AND s.id=$2 AND s.course_id=$4 AND s.kind!='ai_draft' AND length(v.body)<=160000",[user,ref.id,ref.version_id,ref.course_id])).rows[0];if(!original)continue;
   const parsed=wordComments(original.body),comments=parsed.filter(p=>(packet.comments||[]).some((x:any)=>x.id===p.id&&x.text===p.text&&x.anchor===p.anchor)).map(({raw,...p})=>p);if(!comments.length)continue;
   feedback.push({source:{id:original.id,version_id:original.version_id,course_id:original.course_id,title:original.title,kind:original.kind,text_sha256:sha(original.body)},changed:original.current_version!==original.version_id,selected_comment:Math.max(0,comments.findIndex(p=>p.text.length>20&&row.content.text.includes(p.text))),comments});
  }
  let purposeText='';
  const works=(row.input?.student_context?.work||[]).filter((w:any)=>w.origin!=='ai_draft'&&!w.historical&&w.basis==='note_revision'&&(!row.input.course_id||w.course_id===row.input.course_id)).slice(0,1);let draft:FeedbackContext['draft']=null;
  for(const w of works){
   const note=(await c.query("SELECT n.id,n.source_id,n.course_id,n.title,n.body,n.version,s.kind,s.current_version FROM schoolvault.notes n JOIN schoolvault.sources s ON s.user_id=n.user_id AND s.id=n.source_id WHERE n.user_id=$1 AND n.id=$2 AND n.source_id=$3 AND n.course_id=$4 AND coalesce(n.origin,'personal')!='ai_draft' AND s.kind!='ai_draft' AND length(n.body)<=160000",[user,w.id,w.source_id,w.course_id])).rows[0];if(!note||!feedback.some(f=>f.source.course_id===note.course_id))continue;
   purposeText=note.body;const passages=feedbackPassages(note.body);if(!passages.length)continue;const quoted=revisionComparison(row.content.text)?.before;let selected=quoted?passages.indexOf(quoted):-1;if(selected<0&&/Featured/i.test(row.input.question||'')){const featured=passages.findIndex(p=>/\bFeatured\b/.test(p));if(featured>=0)selected=/^These\b/.test(passages[featured+1]||'')?featured+1:featured;}
   draft={note_id:note.id,course_id:note.course_id,source_id:note.source_id,version_id:note.current_version,kind:note.kind,title:note.title,revision:note.version,text_sha256:sha(note.body),changed_since_answer:note.version!==w.note_revision||sha(note.body)!==w.text_sha256,passages,selected:Math.max(0,selected)};
  }
  const memories=draft?(await c.query("SELECT id,kind,course_id,chat_id,body,revision,updated_at FROM schoolvault.student_memory WHERE user_id=$1 AND course_id=$2 AND kind IN('choice','correction') AND (chat_id IS NULL OR chat_id=$3) ORDER BY updated_at DESC,id DESC LIMIT 100",[user,draft.course_id,row.chat_id])).rows:[];
  const purposes=draft?savedPurposes({...draft,text:purposeText},memories,row.chat_id,row.input.student_context?.memories||[]):[];
  return {purposes,feedback:draft?feedback.filter(f=>f.source.course_id===draft!.course_id):feedback,draft,earlier_activity:feedbackActivity(row.input?.question||'')};
 });
}
