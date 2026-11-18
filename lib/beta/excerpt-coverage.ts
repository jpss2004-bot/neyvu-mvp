import {createHash} from 'node:crypto';
import {sourceBlocks,sourceEvidenceBlocks,type SourceBlock,type SourceEvidenceBlock} from './source-blocks';
import {excerptGap} from './search';
export type ExcerptLocation={start_line:number;end_line:number;unit:string|null;start_character?:number;end_character?:number;reason?:'not_selected'|'partial_unit'|'untraced'};
export type ExcerptCoverage={format:'saved-text-excerpt/1';unit_algorithm?:'exact-sentence-groups/2'|'exact-section-groups/3'|'exact-section-groups/4'|'exact-section-groups/5'|'exact-section-groups/6'|'exact-section-groups/7'|'exact-section-groups/8';source_id:string;version_id:string;text_sha256:string;excerpt_sha256:string;saved_characters:number;complete_saved_text:boolean;trace:'exact'|'ambiguous'|'untraced';selected_units:number;selected_locations:ExcerptLocation[];omitted_units:number|null;omitted_locations:ExcerptLocation[];locations_truncated:boolean;partial_units:number};
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const normal=(text:string)=>text.replace(/\r\n/g,'\n');
const lines=(text:string)=>text.split('\n').length;
const located=(block:SourceBlock):block is SourceEvidenceBlock=>'start_character' in block&&typeof block.start_character==='number'&&'end_character' in block&&typeof block.end_character==='number'&&'split' in block&&typeof block.split==='boolean';
// Metadata describes representation of saved text, not capture completeness,
// instructor authority, trust in the device or permission to read another source.
export function excerptCoverage(source:{id:string;version_id:string},body:string,excerpt:string,selectedBlocks?:number[],options:{evidenceUnits?:boolean}={}):ExcerptCoverage{
 const blocks=options.evidenceUnits?[...sourceEvidenceBlocks(body)]:[...sourceBlocks(body)],text=normal(body),quoted=normal(excerpt).trim();
 const starts=[0];for(let i=0;i<text.length;i++)if(text[i]==='\n')starts.push(i+1);
 const crlfEnds=[...body.matchAll(/\r\n/g)].map(m=>m.index!+2);
 const normalizedOffset=(offset:number)=>{let low=0,high=crlfEnds.length;while(low<high){const middle=(low+high)>>>1;if(crlfEnds[middle]<=offset)low=middle+1;else high=middle;}return offset-low;};
 const locations=blocks.map(block=>({start_line:block.start_line,end_line:block.end_line,unit:block.unit,...(located(block)&&block.split?{start_character:block.start_character,end_character:block.end_character}:{})}));
 const bounds=blocks.map(block=>{
  if(located(block)){
   const raw=body.slice(block.start_character,block.end_character),low=block.start_character+(raw.match(/^\s*/)?.[0].length||0),high=block.end_character-(raw.match(/\s*$/)?.[0].length||0);
   return {start:normalizedOffset(low),end:normalizedOffset(high)};
  }
  const low=starts[block.start_line-1],high=starts[block.end_line]??text.length,raw=text.slice(low,high);
  return {start:low+(raw.match(/^\s*/)?.[0].length||0),end:high-(raw.match(/\s*$/)?.[0].length||0)};
 });
 let trace:ExcerptCoverage['trace']='exact',whole=new Set<number>(),partial=new Set<number>();
 if(selectedBlocks){
  for(const i of selectedBlocks)if(Number.isInteger(i)&&i>=0&&i<blocks.length)whole.add(i);else trace='untraced';
  const runs:string[]=[];let previous=-2;
  for(const i of [...whole].sort((a,b)=>a-b)){
   if(i===previous+1)runs[runs.length-1]+=blocks[i].text+'\n\n';else runs.push(blocks[i].text+'\n\n');
   previous=i;
  }
  if(normal(runs.map(run=>run.trim()).join(excerptGap))!==quoted){trace='untraced';whole.clear();}
 }
 else if(quoted){
  // A structured selector may join exact nonadjacent quotations. Never invent
  // a unique pointer when the same wording occurs at multiple source locations.
  const parts=text.includes(quoted)?[quoted]:quoted.split(excerptGap).filter(Boolean);
  const spans:{start:number;end:number}[]=[];
  for(const part of parts){
   const start=text.indexOf(part);
   if(start<0){trace='untraced';break;}
   if(text.indexOf(part,start+1)>=0){trace='ambiguous';break;}
   spans.push({start,end:start+part.length});
  }
  if(trace==='exact')for(let i=0;i<bounds.length;i++){
   const b=bounds[i];
   if(spans.some(s=>s.start<=b.start&&s.end>=b.end))whole.add(i);
   else if(spans.some(s=>s.start<b.end&&s.end>b.start))partial.add(i);
  }
 }
 const missing=locations.flatMap((location,i)=>whole.has(i)?[]:[{...location,reason:partial.has(i)?'partial_unit' as const:'not_selected' as const}]);
 const selected=[...whole].map(i=>locations[i]);
 const unknown=trace!=='exact';
 const omitted=unknown?[{start_line:1,end_line:lines(text),unit:null,reason:'untraced' as const}]:missing;
 return {format:'saved-text-excerpt/1',...(blocks.some(block=>located(block)&&block.split)?{unit_algorithm:'exact-section-groups/8' as const}:{}),source_id:source.id,version_id:source.version_id,text_sha256:hash(body),excerpt_sha256:hash(excerpt),saved_characters:body.length,complete_saved_text:!!body.trim()&&!unknown&&whole.size===blocks.length,trace,selected_units:whole.size,selected_locations:selected.slice(0,4),omitted_units:unknown?null:missing.length,omitted_locations:omitted.slice(0,4),locations_truncated:selected.length>4||omitted.length>4,partial_units:partial.size};
}
// Used when priority facts and existing excerpts are combined. Keep complete
// parts instead of slicing the final string through a condition or surrogate.
export function joinWholeExcerpts(parts:string[],budget=1800){
 if(!Number.isSafeInteger(budget)||budget<0||budget>1800)throw Error('Invalid excerpt budget');
 const chosen:string[]=[];let size=0;
 for(const value of parts){const part=value.trim();if(!part||chosen.includes(part))continue;const extra=part.length+(chosen.length?excerptGap.length:0);if(size+extra>budget)continue;chosen.push(part);size+=extra;}
 return chosen.join(excerptGap);
}
