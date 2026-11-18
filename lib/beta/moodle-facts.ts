import {zoneInstant,CAMPUS_ZONE} from './agenda';
import {unverifiedForumSource} from './source-authority';
const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
const dueLabel=/^(Due(?: date)?|Closes?|Close the quiz):(?:\s|$)/i;
function deadlineLine(url:string,lines:string[]){
 const extension=url.includes('/assign/')?lines.findIndex(s=>/^Extension due date:(?:\s|$)/i.test(s)):-1;
 return extension>=0?extension:lines.findIndex(s=>dueLabel.test(s));
}
// Keep the printed field and, when it fits, the preceding activity instructions
// in one exact excerpt so the existing conflict checker can compare both dates.
export function activityDeadlineExcerpt(url:string,body:string,budget:number){
 const lines=body.split('\n'),index=deadlineLine(url,lines.map(line=>line.trim()));
 if(index<0)return '';
 const field=lines[index].trim(),quote=field.replace(/^[^:]+:\s*/,'')?field:lines.slice(index,index+2).join('\n').trim();
 const stop=lines.findIndex(line=>/^\s*(?:Submission status|Grading status|Last modified)\s*(?:\t|:|$)/i.test(line));
 const instructions=(stop<0?body:lines.slice(0,stop).join('\n')).trim();
 const at=instructions.indexOf(quote);
 if(at>=0){
  if(instructions.length<=budget)return instructions;
  if(instructions.length-at<=budget)return instructions.slice(at);
 }
 return quote;
}
// Only an activity's labelled due/close field is a deadline. Course prose and
// student questions cannot create official dates. No browser-local Date.parse.
export function activityDeadline(url:string,body:string){
 if(unverifiedForumSource({original_url:url}))return null;
 if(!/^https:\/\/moodle\.acadiau\.ca\/mod\/(assign|quiz|forum)\/view\.php\?id=\d+$/.test(url))return null;
 const lines=body.split('\n').map(s=>s.trim());
 const index=deadlineLine(url,lines);
 if(index<0&&url.includes('/forum/'))return null;
 if(index<0)return {due_at:null,due_date:null,note:'No explicit due or close field was captured.'};
 const line=lines[index].replace(/^[^:]+:\s*/,'')||lines[index+1]||'';
 const match=line.match(/^(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+)?(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d\d)(?:,?\s+(\d{1,2}):([0-5]\d)\s*([ap]m)?)?\.?$/i);
 if(!match)return {due_at:null,due_date:null,note:'The captured due field needs review; its date was not guessed.',raw:line.slice(0,200)};
 const date=match[3]+'-'+String(months.indexOf(match[2].toLowerCase())+1).padStart(2,'0')+'-'+match[1].padStart(2,'0');
 try{
  if(!match[4]){zoneInstant(date,'12:00');return {due_at:null,due_date:date,note:'Moodle stated a date without a time.',raw:line};}
  let hour=Number(match[4]);if(match[6]){if(hour<1||hour>12)throw Error('Invalid clock');hour=hour%12+(match[6].toLowerCase()==='pm'?12:0);}
  return {due_at:zoneInstant(date,String(hour).padStart(2,'0')+':'+match[5],CAMPUS_ZONE),due_date:date,note:'Observed on a signed-in laptop; check Moodle for later revisions.',raw:line};
 }catch{return {due_at:null,due_date:null,note:'The captured due field has an invalid or nonexistent campus time.',raw:line};}
}

const workObject=/\b(?:assignments?|homework|quizzes?|quiz|pre[- ]?labs?|labs?|laboratory|worksheets?|reports?|problem sets?|in[- ]class (?:work|activities|activity|exercises?|assignments?)|exercises?|discussion (?:posts?|replies|responses?)|posts?|replies|responses?)\b/i;
const optional=/(?<!not\s)\boptional\b|\b(?:voluntary|for practice only|practice only|not required|not mandatory|not compulsory|no need to|do not need to|don['’]t need to|not an assignment|not assessed|if you (?:want|wish)|you may|you can choose|recommended|suggested|for reference)\b/i;
export const optionalWorkTitle=(title:string)=>optional.test(title);
const historical=/\b(?:last (?:week|month|year|term|semester)|previous (?:term|semester)|previously|formerly|used to|had to|were required to|was required to)\b/i;
const unrelated=/\b(?:example|e\.g\.|sample|hypothetical|demonstration|fictional scenario)\b/i;
const excludedDirective=/\b(?:must|should|may)\s+not\b|\b(?:do|does)\s+not\s+(?:complete|submit|upload|post|bring|respond|reply)\b|\bdon['’]t\s+(?:complete|submit|upload|post|bring|respond|reply)\b|\b(?:if|unless|when assigned|depending on|only when)\b/i;
const directive=/^(?:please\s+)?(?:complete|submit|upload|hand in|turn in|post|reply|respond|bring|do|finish|prepare|answer)\b|\b(?:you|students?|learners?|everyone)\s+(?:must|(?:are|is) required to|have to|need to|(?:are|is) expected to)\b|\b(?:must|need to)\s+be\s+(?:completed|submitted|uploaded|handed in|turned in|posted|brought)\b|\b(?:required|mandatory|compulsory)\s+(?:pre[- ]?lab\s+)?(?:quiz|lab|worksheet|assignment|report|discussion|in[- ]class)\b|\b(?:quiz|quizzes|worksheets?|assignments?|reports?|exercises?)\s+(?:is|are)\s+(?:required|mandatory|compulsory)\b/i;
const clauses=(line:string)=>line.split(/(?<=[.!?])\s+|;\s*|\s+(?:but|however)\s+|\s+and\s+(?=you\s+(?:may|must|need|have)|students?\s+must)/i);
// These are review candidates, not verified outstanding work. No date or
// submission status is inferred from instructional prose or an activity title.
export function workInstructionExcerpts(body:string){
 const excerpts:string[]=[];let excludedSection=false;
 for(const raw of body.split('\n')){
  const line=raw.trim();if(!line||/^>|^["“]/.test(line))continue;
  const heading=line.replace(/^#+\s*/,'');
  if(line.length<=90&&!/[.!?]/.test(line)&&/^(?:optional(?:\s+.*)?|practice(?:\s+(?:only|examples?))?|examples?|samples?|demonstrations?|for reference)\s*:?$/i.test(heading)){excludedSection=true;continue;}
  if(line.length<=90&&!/[.!?]/.test(line)&&/^(?:required(?:\s+.*)?|mandatory(?:\s+.*)?|instructions|requirements|coursework|lab work|in[- ]class work)\s*:?$/i.test(heading)){excludedSection=false;if(!workObject.test(heading))continue;}
  if(excludedSection)continue;
  for(const sentence of clauses(line)){
   const text=sentence.replace(/^(?:[-*•]\s+|\d+[.)]\s+)/,'').trim();
   if(!text||/^>|^["“]/.test(text)||!workObject.test(text)||!directive.test(text)||optional.test(text)||historical.test(text)||unrelated.test(text)||excludedDirective.test(text))continue;
   const bounded=text.slice(0,400);if(!excerpts.includes(bounded))excerpts.push(bounded);
   if(excerpts.length>=6)return excerpts;
  }
 }
 return excerpts;
}
export function workKind(value:string){
 if(/\b(?:quiz|quizzes)\b/i.test(value))return 'quiz';
 if(/\bin[- ]class\b/i.test(value))return 'in_class';
 if(/\b(?:discussion|post|reply|replies)\b/i.test(value))return 'discussion';
 if(/\bworksheet\b/i.test(value))return 'worksheet';
 if(/\breport\b/i.test(value))return 'report';
 if(/\b(?:lab|laboratory|pre[- ]?lab)\b/i.test(value))return 'lab';
 return 'coursework';
}
export function activityWork(url:string,title:string,body:string){
 if(unverifiedForumSource({original_url:url,title}))return null;
 const bookChapter=/^https:\/\/moodle\.acadiau\.ca\/mod\/book\/view\.php\?(?:id=\d{1,12}&chapterid=[1-9]\d{0,11}|chapterid=[1-9]\d{0,11}&id=\d{1,12})$/.test(url);
 const forumPage=/^https:\/\/moodle\.acadiau\.ca\/mod\/forum\/view\.php\?(?:id=\d{1,12}&page=(?:0|[1-9]\d{0,11})|page=(?:0|[1-9]\d{0,11})&id=\d{1,12})$/.test(url);
 if(!bookChapter&&!forumPage&&!/^https:\/\/moodle\.acadiau\.ca\/(?:course\/view\.php\?id=\d+|mod\/(?:assign|quiz|page|book|forum|lesson|workshop)\/view\.php\?id=\d+|mod\/forum\/discuss\.php\?d=\d+)$/.test(url))return null;
 const deadline=activityDeadline(url,body),excerpts=workInstructionExcerpts(body);
 const optionalNouns=url.includes('/quiz/')?['quiz']:['assignment',...['worksheet','report','exercise','homework'].filter(noun=>new RegExp('\\b'+noun+'s?\\b','i').test(title))];
 const optionalObject=new RegExp('\\b(?:this|the|your)\\s+(?:practice\\s+)?(?:'+optionalNouns.join('|')+')\\b','i');
 const explicitlyOptional=optional.test(title)||body.split('\n').flatMap(clauses).some(line=>optional.test(line)&&optionalObject.test(line));
 if(deadline)return {...deadline,kind:url.includes('/quiz/')?'quiz':url.includes('/forum/')?'discussion':'assignment',confirmation:'activity_observed' as const,requirement:explicitlyOptional?(excerpts.length?'unknown':'optional'):excerpts.length?'observed_instruction':'unknown',completion_status:'unknown' as const,active:true,instruction_excerpts:excerpts};
 if(!excerpts.length||optional.test(title))return null;
 return {due_at:null,due_date:null,note:'Observed work instructions need review in Moodle. The date and completion have not been verified.',kind:workKind(excerpts.join(' ')),confirmation:'candidate' as const,requirement:'observed_instruction',completion_status:'unknown' as const,active:true,instruction_excerpts:excerpts};
}
