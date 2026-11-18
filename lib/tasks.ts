import type {Task} from './data';
// Exact official activity identity reconciles linked plan rows with Moodle echoes.
// Personal preparation rows never become official assignments.
export function canonicalTasks(tasks:Task[]){
 const result=new Map<string,Task>();
 const quality=(t:Task)=>(t.receipt_fresh?8:0)+(t.confirmed_submitted?4:0)+(t.source_id==='notion'?2:0)+(t.due_authority==='Moodle'?1:0);
 for(const task of tasks){
  if(task.preparation||!task.official_url?.startsWith('https://moodle.acadiau.ca/'))continue;
  const key=task.course+'|'+task.official_url+(/\/course\/view\.php/.test(task.official_url)?'|'+task.title:'');
  const old=result.get(key);if(!old||quality(task)>quality(old))result.set(key,task);
 }
 return [...result.values()];
}

export type WorkKind='deliverable'|'preparation'|'ongoing'|'support'|'record';
export type WorkItem=Task&{work_kind:WorkKind;date_value:string|null;date_label:string;date_reason:string;completed:boolean;stage:'dated'|'undated'|'completed'|'ongoing'|'preparation'|'support'|'record'};
export function shortTaskTitle(t:Pick<Task,'title'|'course'>){return t.title.replace(new RegExp('^'+t.course+'\\s*[·—:-]?\\s*'),'');}
export function workDay(value:string|null|undefined){if(!value)return null;if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value;const ms=Date.parse(value);return Number.isFinite(ms)?new Intl.DateTimeFormat('en-CA',{timeZone:'America/Halifax',year:'numeric',month:'2-digit',day:'2-digit'}).format(ms):null;}
export function workIndex(tasks:Task[],course=''){
 const canonical=canonicalTasks(tasks),ids=new Set(canonical.map(t=>t.id));
 const rows=[...canonical,...tasks.filter(t=>!ids.has(t.id)&&(!t.official_url?.startsWith('https://moodle.acadiau.ca/')||t.preparation))];
 const result:WorkItem[]=rows.filter(t=>!course||t.course===course).map(t=>{
  let kind:WorkKind='deliverable';
  const unlinkedMatch=!t.official_url&&!t.preparation&&!t.due&&!t.do_on&&!t.planned_due&&canonical.some(o=>o.course===t.course&&o.title===t.title);
  if(!t.title?.trim()||/\bsuperseded\b/i.test(t.title)||unlinkedMatch)kind='record';
  else if(!/^(MATH|COMM|BUSI|PHIL)\s\d/.test(t.course))kind='support';
  else if(t.preparation||(!t.official_url||/\/course\/view\.php/.test(t.official_url))&&/\bpreparation\b/i.test(t.title))kind='preparation';
  else if(/\b(class participation|practice\s*\/\s*engagement|pre-class activities)\b/i.test(t.title)&&!t.due&&!t.do_on)kind='ongoing';
  const official=kind!=='preparation'&&!!t.due&&t.due_authority==='Moodle'&&!/\/course\/view\.php/.test(t.official_url||'');
  const date=official?t.due:t.do_on||t.planned_due||t.due||null;
  const label=official?'Moodle deadline':t.do_on?'Personal work date':t.planned_due?'Notion planning date':kind==='preparation'&&date&&t.due_authority==='Moodle'&&!/\/course\/view\.php/.test(t.official_url||'')?'Linked assignment deadline':date&&t.due_authority==='Moodle'?'Course page date · verify activity':date?'Notion planning date':'Date not established';
  const done=kind!=='preparation'&&t.confirmed_submitted||/^(submitted|graded|done|complete|completed|finished)$/i.test(t.working_status||'');
  return {...t,work_kind:kind,date_value:date,date_label:label,date_reason:official?'Saved official activity date.':date?(label==='Linked assignment deadline'?'The linked assignment deadline does not establish when this personal preparation step is complete.':label==='Course page date · verify activity'?'Saved Moodle course-page date. Verify the specific activity.':'Personal planning evidence; not a verified Moodle deadline.'):/date tba|date.*not.*announced/i.test(t.title)?'The exam date has not been established.':kind==='ongoing'?'An ongoing course expectation, not a dated assignment.':kind==='record'?(unlinkedMatch?'An unlinked personal record has the same course and title as a linked activity. Both are preserved for review; its status is not inferred from the other record.':'An empty or explicitly superseded record, preserved for review.'):t.due_authority==='Moodle'?'Moodle has no explicit due field in the saved activity. Any saved Notion date stays a personal plan.':'No verified deadline or personal work date is present.',completed:done,stage:kind!=='deliverable'?kind:done?'completed':date?'dated':'undated'} as WorkItem;
 });
 return result.sort((a,b)=>(workDay(a.date_value)||'9999-99-99').localeCompare(workDay(b.date_value)||'9999-99-99')||(Date.parse(a.date_value||'')||Infinity)-(Date.parse(b.date_value||'')||Infinity)||a.title.localeCompare(b.title));
}
