// Exact excerpts for class/material comparisons. Page markers may restart when
// unreviewed OCR is appended to native text; positions, not page order, bind them.
export type MaterialWindow={start:number;end:number;unit:string|null;partial_sentence:boolean};
const limit=1100;
const common=new Set('the and for you are was were has had have its our their they them this that these those with from into then than also just can could would should will may must only not does did doing said says say see know mean yes okay there here some such very all any each how what which when where whom whose'.split(' '));
export function classMaterialTerms(text:string){
 return [...new Set((text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g)||[]).filter(word=>!common.has(word)))];
}
export function unverifiedMaterialRange(body:string,start:number,end:number){
 return [...body.matchAll(/<!-- formula-not-decoded -->|Unverified formula-region transcription:[^\n]*(?:\n(?![ \t]*\n)[^\n]*)*/g)].some(m=>start<m.index!+m[0].length&&m.index!<end);
}
function trim(body:string,start:number,end:number){while(start<end&&/\s/u.test(body[start]))start++;while(end>start&&/\s/u.test(body[end-1]))end--;return {start,end};}
export function classMaterialWindows(body:string):MaterialWindow[]{
 const marks=[...body.matchAll(/^(?:Page \d+[^\n]*|Slide \d+[^\n]*|Paragraph \d+[^\n]*)$/gm)];
 const blocks:{start:number;end:number;unit:string|null}[]=[];
 if(!marks.length||(marks[0].index??0)>0)blocks.push({start:0,end:marks[0]?.index??body.length,unit:null});
 for(const [i,mark] of marks.entries())blocks.push({start:mark.index!,end:marks[i+1]?.index??body.length,unit:mark[0].replace(/ — local OCR supplement \(unreviewed\)$/,' (OCR, unreviewed)')});
 const windows:MaterialWindow[]=[];
 for(const block of blocks){
  const atoms:{start:number;end:number;partial:boolean}[]=[];let cursor=block.start;
  // New paragraphs and sentence ends provide natural boundaries. Preserve all
  // intervening whitespace when adjacent atoms are combined into an excerpt.
  const boundaries=[...body.slice(block.start,block.end).matchAll(/[.!?](?=\s|$)|\n[ \t]*\n/g)].map(m=>block.start+m.index!+m[0].length);
  boundaries.push(block.end);
  for(const boundary of boundaries){
   const span=trim(body,cursor,boundary);cursor=boundary;if(span.start===span.end)continue;
   if(span.end-span.start<=limit){atoms.push({...span,partial:false});continue;}
   // A long sentence cannot fit. Keep whole words and name the omitted clause;
   // never produce an apparently complete phrase by cutting through a word.
   let start=span.start;
   while(start<span.end){
    let end=Math.min(start+limit,span.end);
    if(end<span.end){while(end>start&&!/\s/u.test(body[end]))end--;}
    if(end===start){while(start<span.end&&!/\s/u.test(body[start]))start++;while(start<span.end&&/\s/u.test(body[start]))start++;continue;}
    const part=trim(body,start,end);if(part.start<part.end)atoms.push({...part,partial:true});start=end;while(start<span.end&&/\s/u.test(body[start]))start++;
   }
  }
  for(let i=0;i<atoms.length;i++){
   let j=i,end=atoms[i].end,partial=atoms[i].partial;
   while(j+1<atoms.length&&atoms[j+1].end-atoms[i].start<=limit){j++;end=atoms[j].end;partial ||= atoms[j].partial;}
   windows.push({start:atoms[i].start,end,unit:block.unit,partial_sentence:partial});
  }
 }
 return windows;
}
