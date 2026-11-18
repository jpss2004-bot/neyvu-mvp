// Keep AI work in a course notebook while preserving its provenance and its
// distinction from instructor material. AI drafts are never search evidence.
import {calculationRecordText,type CalculationRecord} from './calculation-record';
export type DraftSource={id:string;title:string;version_id?:string;original_url?:string|null};

export function studyDraft(question:string,answer:string,sources:DraftSource[],timezone='UTC',now=new Date(),calculation?:CalculationRecord){
 let day:string;
 try{day=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
 catch{day=now.toISOString().slice(0,10);}
 const heading=question.trim().replace(/\s+/g,' ').slice(0,155);
 const title=`${day} · ${heading}`.slice(0,180);
 const trail=sources.map((source,i)=>`${i+1}. ${source.title}\n   ${source.original_url||'Saved in this SchoolVault account'}\n   Source ID: ${source.id}${source.version_id?' · Version: '+source.version_id:''}`).join('\n');
 const body=[
  'AI-written study draft. Check it against the original course material and write your own submission. This note is not a Moodle submission or grade receipt.',
  `Question\n${question.trim()}`,
  `Worked answer\n${answer.trim()}`,
  ...(calculation?[calculationRecordText(calculation)]:[]),
  `Course sources available at generation time\n${trail||(calculation?'No course source was available. The calculation checks the typed request; original assignment wording and course requirements have not been verified.':'No course source was available. Treat the answer as unverified.')}`,
 ].join('\n\n');
 return {title,body};
}
