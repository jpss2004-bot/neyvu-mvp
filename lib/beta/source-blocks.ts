import {exactSectionGroups} from './exact-source-units';
export type SourceBlock={text:string;start_line:number;end_line:number;unit:string|null;heading:boolean};
const unitMarker=/^(?:Page|Slide|Paragraph) \d+(?: notes)?$|^(?:Page|Image) \d+ — local OCR supplement \(unreviewed\)$/i;
const heading=/^#{1,4}\s+|^(?:requirements?|instructions?|deliverables?|rubric|assessment criteria|submission|learning objectives?|class notes|definitions?|(?:office|consultation) hours?|instructor|professor|lecturer)\s*:?$|^(?:assessment|grading|assignments?|required readings?|learning outcomes?)\s*:/i;

// Keep a saved paragraph with its heading, including a blank line between them.
// Offsets retain original CRLFs; unit markers stay explicit source locators.
export function* sourceBlocks(body:string):Generator<SourceBlock>{
 let unit:string|null=null,start:number|null=null,startLine=0,end=0,endLine=0,lineNumber=0,headed=false,hasBody=false;
 for(const match of body.matchAll(/[^\n]*(?:\n|$)/g)){
  lineNumber++;
  const raw=match[0],line=raw.trim(),marker=unitMarker.test(line),boundary=marker||heading.test(line);
  if(!line||boundary){
   if(!line&&start!==null&&headed&&!hasBody)continue;
   if(start!==null){yield {text:body.slice(start,end).trim(),start_line:startLine,end_line:endLine,unit,heading:headed};start=null;}
   if(!line)continue;
   if(marker){unit=line.length<=160?line:null;yield {text:line,start_line:lineNumber,end_line:lineNumber,unit,heading:true};continue;}
  }
  if(start===null){start=match.index!;startLine=lineNumber;headed=boundary;hasBody=false;}
  else hasBody=true;
  end=match.index!+raw.length;endLine=lineNumber;
 }
 if(start!==null)yield {text:body.slice(start,end).trim(),start_line:startLine,end_line:endLine,unit,heading:headed};
}

export type SourceEvidenceBlock=SourceBlock&{start_character:number;end_character:number;split:boolean};
// Narrow question retrieval can rank exact sentence groups inside a flattened
// paragraph. A physical wrap is kept inside its complete sentence/condition.
// Headed paragraphs retain their existing structural scope.
// The guide still uses sourceBlocks; this is a separately located excerpt view.
export function* sourceEvidenceBlocks(body:string,options:{classroomRestrictions?:boolean}={}):Generator<SourceEvidenceBlock>{
 let cursor=0;
 const newlines=[...body.matchAll(/\n/g)].map(m=>m.index!);
 const lineAt=(offset:number)=>{let low=0,high=newlines.length;while(low<high){const mid=(low+high)>>>1;if(newlines[mid]<offset)low=mid+1;else high=mid;}return low+1;};
 for(const block of sourceBlocks(body)){
  const start=body.indexOf(block.text,cursor);if(start<0)throw Error('Source block location mismatch');
  cursor=start+block.text.length;
  const split=!block.heading&&block.text.length>1800;
  const parts=split?exactSectionGroups(block.text,options):[{start:0,end:block.text.length,text:block.text}];
  for(const part of parts)if(part.text.trim()){
   const contentEnd=start+part.end-(part.text.match(/\s*$/)?.[0].length||0);
   yield {...block,text:part.text,start_line:lineAt(start+part.start),end_line:lineAt(Math.max(start+part.start,contentEnd-1)),start_character:start+part.start,end_character:start+part.end,split};
  }
 }
}
