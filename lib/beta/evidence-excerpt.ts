import {sourceEvidenceBlocks,type SourceEvidenceBlock} from './source-blocks';
import {excerptGap} from './search';

export function renderEvidenceSelection(blocks:SourceEvidenceBlock[],selected:Iterable<number>){
 const runs:string[]=[];let previous=-2;
 for(const index of [...new Set(selected)].sort((a,b)=>a-b)){
  if(!Number.isInteger(index)||!blocks[index])throw Error('Invalid evidence selection');
  const text=blocks[index].text+'\n\n';
  if(index===previous+1)runs[runs.length-1]+=text;else runs.push(text);
  previous=index;
 }
 return runs.map(run=>run.trim()).filter(Boolean).join(excerptGap);
}

// A useful structural table/section may start inside a sentence group. Expand
// to its complete original groups; do not call a cut condition a whole unit.
// Ambiguous, transformed or over-budget priority text keeps the reading path.
export function wholeEvidenceExcerpt(body:string,value:string,budget=1800,blocks=[...sourceEvidenceBlocks(body)]){
 if(!Number.isSafeInteger(budget)||budget<0||budget>1800)throw Error('Invalid evidence budget');
 const quoted=value.trim();if(!quoted)return null;
 const parts=body.includes(quoted)?[quoted]:quoted.split(excerptGap).filter(Boolean),selected=new Set<number>();
 for(const part of parts){
  const start=body.indexOf(part);if(start<0||body.indexOf(part,start+1)>=0)return null;
  const end=start+part.length;
  blocks.forEach((block,index)=>{if(block.start_character<end&&block.end_character>start)selected.add(index);});
 }
 const excerpt=renderEvidenceSelection(blocks,selected);
 return excerpt&&excerpt.length<=budget?{excerpt,selected:[...selected].sort((a,b)=>a-b)}:null;
}
