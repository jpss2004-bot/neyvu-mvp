// Dated tests, midterms, quizzes, exams, presentations and reflections quoted
// from the student's own saved sources. Ported from the personal prototype's
// Sync/assessments.py. Moodle submission activities already reach the agenda;
// in-class assessments usually exist only as a sentence on a course page, an
// announcement or a syllabus, so they never became deadlines.
//
// A claim needs an assessment name and a date in the same line (within 80
// characters and not across ';'). Nothing is inferred without a quote. Claims
// are grouped per course and assessment and ranked: newest Moodle announcement,
// then Moodle page, then syllabus (instructor version number, then newest save),
// then the student's own plan. Disagreements are reported, never resolved
// silently. A saved version time is when this vault saved the text, never the
// Moodle post time. Nothing here says whether an assessment was written or graded.
// Pure parsing and ranking; safe in browser code. Database reads: ./assessments.ts.

export type AssessmentSourceKind='moodle_announcement'|'moodle_page'|'syllabus'|'course_material'|'student_plan';
export const assessmentRank:Record<AssessmentSourceKind,number>={moodle_announcement:0,moodle_page:1,syllabus:2,course_material:2.5,student_plan:3};
export const assessmentSourceLabel:Record<AssessmentSourceKind,string>={moodle_announcement:'Moodle announcement',moodle_page:'Moodle page',syllabus:'syllabus',course_material:'saved course document',student_plan:'your plan'};
export type AssessmentClaim={
 courseId:string;course:string;key:string;date:string;sourceKind:AssessmentSourceKind;quote:string;
 sourceId:string|null;version:string|null;observedAt:string;title:string;url?:string|null;
 // Instructor version number in a syllabus file name ("ver 2.0"); unversioned counts as oldest.
 syllabusVersion?:number;
 // A student plan for "the week of" a date covers that date and the following six days.
 range?:boolean;planState?:string;
};
export type AssessmentConflict=Pick<AssessmentClaim,'date'|'sourceKind'|'quote'|'sourceId'|'version'|'observedAt'|'title'>&{olderSyllabusVersion:boolean};
export type Assessment=Omit<AssessmentClaim,'planState'>&{
 conflicts:AssessmentConflict[];
 planDates:string[];planState:string;claims:number;allDates:string[];
};

const MONTHS=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const MONTH='(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?';
const DAY='(\\d{1,2})(?:st|nd|rd|th)?';
const dateRe=()=>new RegExp('\\b(?:'+MONTH+'\\s+'+DAY+'|'+DAY+'\\s+'+MONTH+'(?!\\s+\\d{1,2}(?:\\D|$)))(?:,?\\s+(20\\d\\d))?\\b','gi');
// The prototype accepted "Midterm i" from "Midterm in class"; a number must end at a word boundary.
const NUM='(?:(?:\\d+|iv|i{1,3}|one|two|three)(?![a-z0-9]))';
const assessRe=new RegExp('\\b(final\\s+exams?\\b|exams?\\b|midterm\\s*'+NUM+'?|lab\\s+quiz\\s*'+NUM+'?|t\\s*est\\s*'+NUM+'?(?=\\b)|'
 +'quiz(?:zes)?\\s*'+NUM+'?|t\\s*est\\s+day|reflections?\\b[^|.\\n]{0,60}\\b(?:due|by)\\b|presentations?\\b[^|.\\n]{0,30}\\b(?:date|day)|oral\\s+quiz\\s*'+NUM+'?)','i');
const ROMAN:Record<string,number>={i:1,ii:2,iii:3,iv:4,one:1,two:2,three:3};
// Practice material and review announcements do not date the assessment itself.
const noise=/test reviews will be announced|prior year|practice (?:questions|test|exam|midterm|quiz)|study guide|review session|sample (?:test|exam|midterm)/i;
// Never copy credentials or account hints into the workspace.
export const credentialText=/pass\s*word|passcode|\bpin\b|username|user name|student id|student number|log ?in with/i;

const isoDate=(y:number,m:number,d:number)=>{const t=new Date(Date.UTC(y,m-1,d));return t.getUTCFullYear()===y&&t.getUTCMonth()===m-1&&t.getUTCDate()===d?t.toISOString().slice(0,10):null;};
// A date without a year belongs to the academic year the text was saved in.
// A month more than six months before the save belongs to the next calendar year.
function resolveDate(match:RegExpExecArray,observedAt:string,fallbackYear:number){
 const month=MONTHS.indexOf((match[1]||match[4]||'').slice(0,3).toLowerCase())+1,day=Number(match[2]||match[3]);
 if(month<1||!day)return null;
 if(match[5])return isoDate(Number(match[5]),month,day);
 const saved=Date.parse(observedAt),base=Number.isFinite(saved)?new Date(saved).getUTCFullYear():fallbackYear;
 const date=isoDate(base,month,day);if(!date)return null;
 return Number.isFinite(saved)&&Date.parse(date+'T12:00:00Z')<saved-183*86400000?isoDate(base+1,month,day):date;
}

// Normalised assessment key, e.g. 'test 1', 'midterm 1', 'lab quiz 3', 'final exam', 'test'.
export function assessmentKey(text:string){
 const t=text.toLowerCase().replace(/\bt\s+est\b/g,'test');
 const m=t.match(/(final exam|exam|midterm|lab quiz|oral quiz|quiz(?:zes)?|test|reflection|presentation)\s*(\d+|iv|i{1,3}|one|two|three)?(?![a-z0-9])/)||t.match(/(final exam|exam|midterm|lab quiz|oral quiz|quiz(?:zes)?|test|reflection|presentation)/);
 if(!m)return null;
 let kind=m[1]==='quizzes'?'quiz':m[1],number=m[2];
 const ordinal=t.match(new RegExp('\\b(first|second|third)\\s+(?:in-class\\s+|written\\s+)?'+kind));
 if(!number&&ordinal)number={first:'1',second:'2',third:'3'}[ordinal[1] as 'first'];
 if(kind==='exam')kind='final exam';
 if(number)number=String(ROMAN[number]??Number(number));
 return kind+(number?' '+number:'');
}

type ClaimSource=Omit<AssessmentClaim,'key'|'date'|'quote'>;
export function assessmentClaimsFromText(text:string,source:ClaimSource,fallbackYear=new Date().getUTCFullYear()):AssessmentClaim[]{
 const found:AssessmentClaim[]=[];
 for(const raw of (text||'').split(/\n|\s\|\s|(?<=[.!?])\s+(?=[A-Z])/)){
  const line=raw.trim();
  if(!line||noise.test(line)||credentialText.test(line))continue;
  const labels=[...line.matchAll(new RegExp(assessRe.source,'gi'))];
  if(!labels.length)continue;
  const opening=[...line.matchAll(/\b(?:opened|opens?|opening date)\s*:\s*[^;\n]*?(?=\b(?:closes?|due|ends?)\s*:|;|$)/gi)].map(m=>({start:m.index!,end:m.index!+m[0].length}));
  const blockers=[...labels,...line.matchAll(/\b(?:HW\s*\d+|homework|assignment)\b/gi)];
  const dates=[...line.matchAll(dateRe())].filter(m=>!opening.some(span=>m.index!>=span.start&&m.index!<span.end)
   // In "9 Nov 2–6", 9 is a week number, not 9 November.
   &&!(m[3]&&/^\s+\d/.test(line.slice(m.index!+m[0].length)))
   // A calendar week is not an exact assessment date.
   &&!/^\s*[–-]\s*(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*)?\d/i.test(line.slice(m.index!+m[0].length))
   &&! /\d(?:st|nd|rd|th)?\s*[–-]\s*$/i.test(line.slice(0,m.index!))
   &&! /\bweek of\s*$/i.test(line.slice(0,m.index!)));
  for(const assessment of labels){
   const aStart=assessment.index!,aEnd=aStart+assessment[0].length;
   const distance=(m:RegExpExecArray)=>Math.max(0,Math.max(m.index!,aStart)-Math.min(m.index!+m[0].length,aEnd));
   const nearby=dates.filter(m=>{
    const start=Math.min(m.index!+m[0].length,aEnd),end=Math.max(m.index!,aStart),gap=line.slice(start,end);
    if(distance(m)>80||gap.includes(';'))return false;
    const otherDistance=(other:RegExpMatchArray)=>Math.max(0,Math.max(m.index!,other.index!)-Math.min(m.index!+m[0].length,other.index!+other[0].length));
    if(blockers.some(other=>other!==assessment&&otherDistance(other)<=distance(m)
     &&!line.slice(Math.min(m.index!+m[0].length,other.index!+other[0].length),Math.max(m.index!,other.index!)).includes(';')))return false;
    // Never borrow a date across another assessment or a homework due label.
    if(labels.some(other=>other!==assessment&&other.index!>=start&&other.index!<end)||/\b(?:HW\s*\d+|homework|assignment)\b/i.test(gap))return false;
    return true;
   }).sort((a,b)=>distance(a)-distance(b));
   const when=nearby[0];if(!when)continue;
   const date=resolveDate(when,source.observedAt,fallbackYear);if(!date)continue;
   const prefix=line.slice(Math.max(0,aStart-25),aStart);
   let key=assessmentKey(assessment[0]);
   if(/\b(?:first|second|third)\b/i.test(prefix)&&!labels.some(other=>other!==assessment&&other.index!>=Math.max(0,aStart-25)&&other.index!<aStart))key=assessmentKey(prefix+assessment[0]);
   if(!key)continue;
   const titleKey=assessmentKey(source.title);
   if(source.sourceKind!=='student_plan'&&titleKey&&titleKey.startsWith(key+' ')&&/^\d+$/.test(titleKey.slice(key.length+1)))key=titleKey;
   const begin=Math.max(0,Math.min(aStart,when.index!)-30),end=Math.min(line.length,Math.max(aEnd,when.index!+when[0].length)+50);
   found.push({...source,key,date,quote:line.slice(begin,Math.min(end,begin+220))});
  }
 }
 return found;
}

// A personal plan counts only when its title names the assessment itself
// ("Test 1 — week of Oct 5–9"), not work toward it ("Study for Test 1").
const planTitle=/^(?:[A-Z]{2,5}\s?\d{3,4}[A-Z]?\s*[·:|\-–—]?\s*)?(?:the\s+)?(?:final\s+exam|exam|midterm|lab\s+quiz|oral\s+quiz|test|reflection|presentation)\b/i;
export function planAssessmentClaim(plan:{courseId:string;course:string;id:string;title:string;planned_on:string|null;state:string;updated_at?:string|null;version_id?:string|null}):AssessmentClaim|null{
 if(!plan.planned_on||!/^\d{4}-\d{2}-\d{2}$/.test(plan.planned_on)||plan.state==='archived'||!planTitle.test(plan.title.trim())||credentialText.test(plan.title))return null;
 const key=assessmentKey(plan.title);if(!key)return null;
 return {courseId:plan.courseId,course:plan.course,key,date:plan.planned_on,sourceKind:'student_plan',quote:plan.title.slice(0,220),sourceId:plan.id,version:plan.version_id??null,
  observedAt:plan.updated_at||'',title:plan.title,range:/\bweek of\b/i.test(plan.title),planState:plan.state};
}

const ts=(value:string)=>{const t=Date.parse(value);return Number.isFinite(t)?t:0;};
const addDays=(date:string,n:number)=>new Date(Date.parse(date+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const order=(a:AssessmentClaim,b:AssessmentClaim)=>assessmentRank[a.sourceKind]-assessmentRank[b.sourceKind]
 ||(a.sourceKind==='syllabus'?(b.syllabusVersion??0)-(a.syllabusVersion??0):0)||ts(b.observedAt)-ts(a.observedAt);

export function reconcileAssessments(claims:AssessmentClaim[]):Assessment[]{
 const groups=new Map<string,AssessmentClaim[]>(),id=(c:{courseId:string;key:string})=>c.courseId+'\u0000'+c.key;
 for(const c of claims){const k=id(c);groups.set(k,[...(groups.get(k)||[]),c]);}
 // "Test" without a number is the same event as a numbered test on the same date
 // (or within a "week of" plan range).
 for(const [k,group] of [...groups]){
  const [courseId,key]=k.split('\u0000');
  if(!['test','midterm','lab quiz','oral quiz'].includes(key))continue;
  const dates=new Set(group.map(c=>c.date));
  const covers=(c:AssessmentClaim)=>dates.has(c.date)||!!c.range&&[...dates].some(d=>c.date<=d&&d<=addDays(c.date,6));
  const target=[...groups.keys()].find(t=>{const [tc,tk]=t.split('\u0000');return tc===courseId&&tk.startsWith(key+' ')&&groups.get(t)!.some(covers);});
  if(target){groups.set(target,[...groups.get(target)!,...group]);groups.delete(k);}
 }
 const items:Assessment[]=[];
 for(const [groupKey,group] of groups){
  // Newest claim within the most authoritative source kind wins.
  group.sort(order);
  const {planState:_unused,...best}=group[0],firm=group.filter(c=>!c.range);
  const official=firm.filter(c=>c.sourceKind!=='student_plan'&&c.date!==best.date);
  const conflicts=official.map(c=>({date:c.date,sourceKind:c.sourceKind,quote:c.quote,sourceId:c.sourceId,version:c.version,observedAt:c.observedAt,title:c.title,
   olderSyllabusVersion:c.sourceKind==='syllabus'&&best.sourceKind==='syllabus'&&(c.syllabusVersion??0)<(best.syllabusVersion??0)}));
  // A merged "Test" takes the numbered name it was merged into.
  items.push({...best,key:groupKey.split('\u0000')[1],range:!!best.range,conflicts,
   planDates:[...new Set(firm.filter(c=>c.sourceKind==='student_plan'&&c.date!==best.date).map(c=>c.date))].sort(),
   planState:group.find(c=>c.sourceKind==='student_plan'&&c.planState)?.planState||'',
   claims:group.length,allDates:[...new Set(firm.map(c=>c.date))].sort()});
 }
 return items.sort((a,b)=>a.date.localeCompare(b.date)||a.course.localeCompare(b.course)||a.key.localeCompare(b.key));
}

// Today's split: upcoming within the horizon, and recent past without a "done" plan.
export function assessmentWindow(items:Assessment[],today:string,horizon=30,lookback=7){
 const end=addDays(today,horizon),start=addDays(today,-lookback);
 return {upcoming:items.filter(i=>i.date>=today&&i.date<=end),
  recent:items.filter(i=>i.date>=start&&i.date<today&&i.planState!=='done')};
}

