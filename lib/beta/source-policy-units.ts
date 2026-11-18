import {aiClassroomRestrictions} from './source-rule-units';
// Exact saved-text ranges only. A numbered rule retains qualifications and
// nested steps through its next peer item or explicit section heading.
// Page markers alone are not semantic boundaries.
export function latePolicyUnits(body:string){
 const label=String.raw`Late\s+(?:assignments?|reports?|papers?|essays?|submissions?|homework|work)\b`;
 const starts=[...body.matchAll(new RegExp(String.raw`^[ \t]*(?:\d{1,6}[.)]\s*)?${label}|(?<!\S)\d{1,6}[.)][ \t]+${label}`,'gim'))];
 const ranges:{start:number;end:number;text:string;closed:boolean}[]=[];
 for(const match of starts){
  const ordinal=match[0].match(/^[ \t]*(\d{1,6})[.)]/);
  const peer=ordinal?'(?:\\n[ \\t]*|[ \\t]+)'+String(Number(ordinal[1])+1)+'[.)](?=[ \\t\\r\\n]|$)|':'';
  const boundary=new RegExp(peer+'\\n[ \\t]*(?:A Few Notes|Academic Integrity|Evaluation|Grading|Attendance|Office hours|Course requirements|Assessment)\\b','i');
  const tailStart=match.index!+match[0].length,tail=body.slice(tailStart),stop=boundary.exec(tail);
  const inline=body.slice(body.lastIndexOf('\n',match.index!-1)+1,match.index!).trim().length>0;
  if(inline&&!stop)continue;
  const rawStart=match.index!,end=stop?tailStart+stop.index+(stop[0].match(/^\s*/)?.[0].length||0):body.length;
  const raw=body.slice(rawStart,end),start=rawStart+(raw.match(/^\s*/)?.[0].length||0);
  if(end>start)ranges.push({start,end,text:body.slice(start,end),closed:!!stop});
 }
 const merged:typeof ranges=[];
 for(const range of ranges){
  const last=merged.at(-1);
  if(last&&range.start<last.end){last.end=Math.max(last.end,range.end);last.text=body.slice(last.start,last.end);last.closed=last.closed&&range.closed;}
  else merged.push({...range});
 }
 return merged;
}

export function latePolicyLookupQuestion(input:{question?:string;mode?:string}){
 if(input.mode&&input.mode!=='ask')return false;
 const q=input.question||'';
 return /\blate\b/i.test(q)&&/\b(?:assignments?|reports?|papers?|essays?|submissions?|homework|work|polic\w*)\b/i.test(q)
  &&!/\b(?:AI|academic integrity|attendance|arrivals?|quiz(?:zes)?|exams?|tests?|labs?|write|draft|compose|solve|calculate|how much|chang\w*|updat\w*|announc\w*|say|says|said|tell|told|email\w*|reopen\w*|revis\w*|later|new|current|submitted|resubmit\w*|grad\w*|scores?|feedback|receipts?)\b/i.test(q)
  &&!/\b(?:assignment|homework|report|paper|essay)\s+(?:\d{1,3}|[IVX]+)\b/i.test(q);
}

export const syllabusPolicyTitle=/\bsyllabus\b|course[ _-]*(?:outline|overview)/i;
export const possiblePolicyTitle=/syllab\w*|polic\w*|course[ _-]*(?:outline|overview|requirements?|guide|handbook)/i;

// A first-person acknowledgement of AI's advantages is not the student's
// disclosure requirement. Prefer actual modal rules when that is the question.
export function aiDisclosurePriority(text:string,question:string){
 if(!/\b(?:AI|GenAI|generative|artificial intelligence|ChatGPT)\b/i.test(question)||!/\backnowledg\w*|\bdisclos\w*/i.test(question))return 0;
 const disclosure=text.split(/(?<=[.!?])\s+/).some(sentence=>/\b(?:must|required to|have to|need to|shall)\s+(?:\w+\s+){0,3}(?:acknowledg\w*|disclos\w*)\b|\b(?:acknowledg\w*|disclos\w*)\s+(?:\w+\s+){0,3}(?:must|required|mandatory)\b/i.test(sentence)
  &&/\b(?:AI|GenAI|generative|ChatGPT)\b/i.test(sentence));
 return disclosure?12:aiClassroomRestrictions(text).length?11:0;
}
