import type {SchoolData} from './data';
import type {Source} from './pilot';
import {canonicalTasks} from './tasks';
import {planningWindow,halifaxDay,wantsFullAnswer} from './replies';
export function localDate(value:string|null){return value?new Date(value).toLocaleString('en-CA',{timeZone:'America/Halifax',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Date unverified';}
export function dailyAnswer(school:SchoolData,question:string,course:string,now=Date.now()){
  const sources:Source[]=[],window=planningWindow(question,now);
  const focused=school.focus.filter(t=>!course||t.course===course).slice(0,3);
  let selected=canonicalTasks(school.tasks).filter(t=>(!course||t.course===course)&&!!t.due&&t.due_authority==='Moodle');
  selected=selected.filter(t=>Date.parse(t.due!)>=now&&halifaxDay(Date.parse(t.due!))>=window.start&&halifaxDay(Date.parse(t.due!))<=window.end&&!t.confirmed_submitted).sort((a,b)=>Date.parse(a.due!)-Date.parse(b.due!));
  const unique=new Set<string>();selected=selected.filter(t=>{const key=t.official_url+'|'+t.title;if(unique.has(key))return false;unique.add(key);return true;});
  const label=(code:string,title:string)=>title.startsWith(code+' · ')?title:code+' · '+title;
  const lines:string[]=[],details:string[]=[];
  if(!/\b(due|deadlines?)\b/i.test(question)&&focused.length){
    lines.push('### Start here');
    for(const t of focused){sources.push({id:t.id,title:t.title,url:t.url,course:t.course});lines.push(`- **${label(t.course,t.title)}** — ${t.action} [${sources.length}]`);}
  }
  lines.push(`\n### Deadlines ${window.label}`);
  if(!selected.length)lines.push('No upcoming official deadline is established in this scope by the saved evidence.');
  else lines.push(`${selected.length} saved official deadline${selected.length===1?'':'s'}; ${Math.min(3,selected.length)} shown here.`);
  selected.forEach((t,i)=>{
    sources.push({id:t.id,title:t.title,url:t.official_url,course:t.course,observed_at:t.receipt_checked});
    const row=`- **${label(t.course,t.title)}** — ${localDate(t.due)}. ${t.label}. [${sources.length}]`;
    (i<3?lines:details).push(row);
  });
  return {content:lines.join('\n'),details:details.length?'### Remaining deadlines\n'+details.join('\n'):'',detailsLabel:details.length+' more deadlines',caution:selected.length?'Dates come from saved Moodle evidence. A deadline does not establish submission status.':'Source coverage may be incomplete; this does not establish that nothing is due.',expandDetails:/\ball\b/i.test(question)||wantsFullAnswer(question),sources,mode:'Verified planning rules'};
}
