import {digest,type ClassSegment} from './class-recording-format';
import {addDays,zoneDate} from './agenda';

export const classActionAlgorithm='class-actions-v2';
export type ClassActionCandidate={key:string;quote:string;context:string;start:number;end:number;segments:{index:number;quote:string;start_ms:number;end_ms:number;uncertain:boolean}[];optional:boolean;conditional:boolean;ambiguous:boolean;stated_date:string|null;date_phrase:string|null;date_basis:string;title:string};

const verb='(?:read|review|prepare|bring|complete|finish|submit|upload|post|reply|answer|practice|practise|solve|write|attempt|take|summarize|derive|explain|discuss|watch|listen|annotate|revise|correct|compare|evaluate|study|work through)';
// Retain a spoken course preamble instead of requiring the action verb to be
// the first word. Limit this to explicit class/lab contexts; arbitrary prose
// before a comma is not evidence of an instruction.
const coursePreamble='(?:(?:for|before|after|during|in)\\s+(?:this|the|our|your|next|the next)\\s+(?:lab|class|discussion|tutorial|seminar|presentation)\\s*,\\s*)?';
const instruction=new RegExp('^'+coursePreamble+'(?:(?:optional|suggested|recommended)\\s*:\\s*)?(?:please\\s+)?'+verb+'\\b|\\b(?:you|we|students?|teams?|groups?|presenting teams)\\s+(?:must|should|may|can|need to|have to|are required to)\\s+'+verb+'\\b|\\b(?:only|if|unless)\\b.{0,100}\\b(?:need|must|should|required)\\b','i');
const schoolObject=/\b(?:chapter|pages?|paper|reading|slides?|notes?|examples?|questions?|problems?|quiz|lab|appendix|reflection|report|assignment|exercise|worksheet|discussion|forum|class|tutorial|presentation|project|draft|outline|syllabus|rubric|case|recording)\b/i;
const withdrawn=/\b(?:do not|don't|don’t|no need to|need not|must not|should not|may not|not required|not mandatory|not assessed|cancelled|canceled|no longer)\b/i;
const speculative=/\b(?:hypothetical|for example|suppose|imagine|someone asked|a student asked|last week|previously|used to)\b/i;
const optional=/\b(?:optional|recommended|suggested|voluntary|may|can|should|for practice only)\b/i;
const conditional=/\b(?:only|if|unless|except|presenting|your team|some teams|not all)\b/i;
const timing=/\b(?:by|before|for|on|due(?:\s+on)?)\s+(?:\d{4}-\d{2}-\d{2}|tomorrow|today|(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|next (?:class|week)|the next class)\b/i;

function spans(value:string){const result:{start:number;end:number;text:string}[]=[];let start=0;for(const m of value.matchAll(/[.!?](?=\s|$)/g)){const end=m.index!+1;result.push({start,end,text:value.slice(start,end)});start=end;}if(value.slice(start).trim())result.push({start,end:value.length,text:value.slice(start)});return result;}
export const classTextBound=(value:string,limit:number)=>value.slice(0,limit).replace(/[\uD800-\uDBFF]$/,'');
function statedDate(quote:string,recordedAt:Date,zone:string){
 const match=timing.exec(quote);if(!match)return {stated_date:null,date_phrase:null,date_basis:'not_stated'};
 const phrase=match[0],value=phrase.replace(/^(?:by|before|for|on|due(?:\s+on)?)\s+/i,'').toLowerCase();
 let date:string|null=null,basis='unresolved';
 if(/^\d{4}-\d{2}-\d{2}$/.test(value)){const d=new Date(value+'T12:00:00Z');if(Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value){date=value;basis='literal_date';}}
 else if(value==='today'||value==='tomorrow'){date=addDays(zoneDate(recordedAt,zone),value==='today'?0:1);basis='relative_to_reported_class_clock';}
 // "next Thursday", "before Friday" and "next class" need review rather
 // than an assumed exact deadline or timetable. The literal wording is kept.
 return {stated_date:date,date_phrase:phrase,date_basis:basis};
}

export function classActionCandidates(segments:ClassSegment[],recordedAt:Date,zone:string){
 let text='';const ranges:{start:number;end:number;index:number}[]=[];
 for(const [index,segment] of segments.entries()){if(text)text+=' ';const start=text.length;text+=segment.text;ranges.push({start,end:text.length,index});}
 const sentences=spans(text),items:ClassActionCandidate[]=[],seen=new Set<string>();let oversized=0,limited=false;
 for(const [i,sentence] of sentences.entries()){
  const quote=sentence.text.trim();if(!instruction.test(quote)||!schoolObject.test(quote)||quote.includes('?')||withdrawn.test(quote))continue;
  const neighbors=sentences.slice(Math.max(0,i-1),i+2).map(s=>s.text.trim()).join(' '),ambiguous=speculative.test(neighbors)||withdrawn.test(neighbors);
  // A hypothetical or interrogative instruction is not assigned work. Keep
  // its words in the transcript; do not create a task from that question.
  if(speculative.test(quote))continue;
  let identity=quote.toLowerCase().replace(timing,'').replace(/[.!?]+$/,'').replace(/^please\s+/,'').replace(/^.*?\b(?:must|should|need to|have to|are required to)\s+/,'').replace(/\s+/g,' ').trim();
  const key=digest(identity);if(seen.has(key))continue;seen.add(key);
  if(quote.length>1800){oversized++;continue;}
  if(items.length>=100){limited=true;continue;}
  const start=sentence.start+sentence.text.indexOf(quote),end=start+quote.length;
  const refs=ranges.filter(r=>r.end>start&&r.start<end).map(r=>{const s=segments[r.index];return {index:r.index,quote:text.slice(Math.max(start,r.start),Math.min(end,r.end)),start_ms:s.start_ms,end_ms:s.end_ms,uncertain:s.uncertain};});
  if(refs.length>100){oversized++;continue;}
  items.push({key,quote,context:classTextBound(neighbors,4000),start,end,segments:refs,optional:optional.test(quote),conditional:conditional.test(quote),ambiguous:ambiguous||neighbors.length>4000||refs.some(r=>r.uncertain),...statedDate(quote,recordedAt,zone),title:classTextBound(quote,180)});
 }
 return {items,observed_keys:[...seen],limitations:['Rule-based candidate discovery is partial; it does not establish that every class instruction was found.','Speakers are unidentified. Confirm applicability, conditions and timing against the audio and Moodle.',...(oversized?[`${oversized} long instruction spans need manual transcript review.`]:[]),...(limited?['More than 100 candidates were found; review the full transcript for additional work.']:[])]};
}

export function classActionStatus(plan:any){
 const evidence=plan.class_evidence;if(!evidence)return null;
 const review=plan.class_review?.binding===evidence.binding?plan.class_review.decision:'unreviewed';
 return {review,needs_review:review==='unreviewed'||evidence.status!=='current'&&review==='applies',active:evidence.status==='current'&&review!=='not_applicable',conflict:null as string|null};
}
