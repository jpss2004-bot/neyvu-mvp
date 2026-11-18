// Exact text only. No hard cuts, summaries or inferred source authority.
// exactSourceUnits stays in parity with source_evidence_reader._lines.
import {latePolicyUnits} from './source-policy-units';
import {classExceptionUnits} from './dated-class-evidence';
import {aiClassroomRestrictions} from './source-rule-units';
const qualification=/^(?:however|unless|except|otherwise|only|but|this|these|those|it|they|if|when|provided|subject|sin embargo|a menos|excepto|solo|esto|esta|estas)\b/i;
const abbreviation=/(?:\b(?:dr|mr|mrs|ms|prof|etc|vs|no|fig|ch|sec)|\b[A-Z]|e\.g|i\.e)\.$/i;
const gradedHeading=/\b[A-Z][a-z]+(?:[ -](?:[A-Z][a-z]+|of|and|for|the|to|in)| \d+){0,8}\s*[*†]?\s*:?\s*\(\d+(?:\.\d+)?\s*%[^)\n]*\)\s*:?/g;
const majorHeading=/\b(?:ACADEMIC INTEGRITY|COURSE STRUCTURE|COURSE PROGRAM|COURSE SCHEDULE|SCHEDULE(?: of)? (?:CLASSES(?: & ASSIGNMENTS)?|ASSIGNMENTS)|GRADING RUBRIC|GUIDELINES FOR)\b/;
// A labelled graded section carries its weight and all following conditions.
// A running mention or quoted label is not a new section. Unknown headings
// remain ordinary text; this is structural location, never course authority.
export function gradedSections(body:string){
 const headings=[...body.matchAll(gradedHeading)].filter(m=>{let at=m.index!-1;while(at>=0&&/\s/.test(body[at]))at--;return at<0||/[.!?:)/]/.test(body[at]);});
 return headings.map((heading,i)=>{
  const start=heading.index!,tail=body.slice(start,headings[i+1]?.index??body.length),stop=tail.slice(heading[0].length).search(majorHeading);
  const end=start+(stop<0?tail.length:heading[0].length+stop);
  return {start,end,text:body.slice(start,end),heading:heading[0]};
 });
}
// Version8 overlays closed policy, classroom restriction and date units on existing groups. Inserting a
// local rule must not repack unrelated later passages. Oversized sections stay
// whole and require the existing reader path when selected.
export function exactSectionGroups(body:string,options:{classroomRestrictions?:boolean}={}){
 const graded=gradedSections(body),late=latePolicyUnits(body).filter(p=>p.closed),exceptions=classExceptionUnits(body).filter(p=>!late.some(l=>l.start<p.end&&l.end>p.start));
 const restrictions=options.classroomRestrictions===false?[]:aiClassroomRestrictions(body).filter(p=>![...late,...exceptions].some(l=>l.start<p.end&&l.end>p.start));
 const ranges=[...late,...exceptions,...restrictions].filter(p=>!graded.some(g=>g.start<p.end&&g.end>p.start)).sort((a,b)=>a.start-b.start);
 const policies:{start:number;end:number;text:string}[]=[];
 for(const range of ranges){
  const previous=policies.at(-1);
  if(previous&&range.start<previous.end){previous.end=Math.max(previous.end,range.end);previous.text=body.slice(previous.start,previous.end);}
  else policies.push({start:range.start,end:range.end,text:range.text});
 }
 let base:{start:number;end:number;text:string}[]=[];
 if(graded.length<2)base=exactSentenceGroups(body);
 else{
  let cursor=0;
  const ordinary=(start:number,end:number)=>{for(const part of exactSentenceGroups(body.slice(start,end)))base.push({start:start+part.start,end:start+part.end,text:part.text});};
  for(const section of graded){ordinary(cursor,section.start);base.push({start:section.start,end:section.end,text:section.text});cursor=section.end;}
  ordinary(cursor,body.length);
 }
 if(!policies.length)return base;
 const out=policies.map(({start,end,text})=>({start,end,text}));
 for(const group of base){
  let cursor=group.start;
  for(const policy of policies){
   if(policy.end<=group.start||policy.start>=group.end)continue;
   if(policy.start>cursor)out.push({start:cursor,end:policy.start,text:body.slice(cursor,policy.start)});
   cursor=Math.max(cursor,Math.min(group.end,policy.end));
  }
  if(cursor<group.end)out.push({start:cursor,end:group.end,text:body.slice(cursor,group.end)});
 }
 return out.sort((a,b)=>a.start-b.start);
}
// Retrieval may encounter physical wraps or index-chunk newlines inside a
// logical paragraph. A newline alone is never a sentence/condition boundary.
export function exactSentenceGroups(body:string){
 const points:number[]=[];
 for(const m of body.matchAll(/[.!?]\s+(?=[A-ZÁÉÍÓÚÑÜ])/g)){
  const point=m.index!+m[0].length;
  if(!qualification.test(body.slice(point))&&!abbreviation.test(body.slice(0,m.index!+1)))points.push(point);
 }
 const result:{start:number;end:number;text:string}[]=[];
 for(let start=0;start<body.length;){
  const before=points.filter(n=>n>start&&n<=start+1600);
  const end=body.length-start<=1600?body.length:before.at(-1)??points.find(n=>n>start)??body.length;
  result.push({start,end,text:body.slice(start,end)});start=end;
 }
 return result;
}
export function exactSourceUnits(body:string){
 const rows:{line:number;start:number;end:number;text:string}[]=[];
 let offset=0;
 for(const part of body.split('\n')){
  const end=offset+part.length+(offset+part.length<body.length?1:0),text=body.slice(offset,end);
  const breaks:number[]=[];
  if(text.length>1600)for(const m of text.matchAll(/[.!?][ \t]+(?=[A-ZÁÉÍÓÚÑÜ])/g)){
   const point=m.index!+m[0].length;
   if(!qualification.test(text.slice(point))&&!abbreviation.test(text.slice(0,m.index!+1)))breaks.push(offset+point);
  }
  let start=offset;
  while(start<end){
   const before=breaks.filter(n=>n>start&&n<=start+1600);
   const until=end-start<=1600?end:before.at(-1)??breaks.find(n=>n>start)??end;
   rows.push({line:rows.length+1,start,end:until,text:body.slice(start,until)});start=until;
  }
  if(offset===end)rows.push({line:rows.length+1,start:offset,end,text:''});
  offset=end;
 }
 return rows;
}
