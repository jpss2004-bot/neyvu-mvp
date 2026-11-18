import {createHash} from 'node:crypto';
export const profileAlgorithm='source-profile-v1';
export const profileModel='qwen3:4b-instruct';
export const profileModelDigest='0edcdef34593eac1aa2be9c7d06c432dcf81945adca5eca2f27662c18f168ba0';
export const profileKinds=['requirement','rubric','policy','concept','argument','example','uncertainty'] as const;
export type ProfileFact={kind:typeof profileKinds[number]|'wording';interpretation:string;start:number;end:number;quote_sha256:string;origin?:'source_wording'|'local_model';review_issue?:string};
export const textHash=(body:string)=>createHash('sha256').update(body).digest('hex');
function boundary(body:string,index:number){return index>0&&index<body.length&&/[\uDC00-\uDFFF]/.test(body[index])&&/[\uD800-\uDBFF]/.test(body[index-1])?index-1:index;}
export function profileChunk(body:string,cursor:number){
 if(!Number.isSafeInteger(cursor)||cursor<0||cursor>=body.length)throw Error('Invalid profile cursor');
 let end=Math.min(body.length,cursor+6000);
 if(end<body.length){const line=body.lastIndexOf('\n',end);if(line>=cursor+4000)end=line+1;}
 end=boundary(body,end);
 const start=boundary(body,Math.max(0,cursor-400)),until=boundary(body,Math.min(body.length,end+400));
 return {start,end,text_start:start,text_end:until,cursor,text:body.slice(start,until)};
}
export function validateProfileFacts(body:string,chunk:ReturnType<typeof profileChunk>,output:any){
 if(!Array.isArray(output?.facts)||output.facts.length>4||!Number.isSafeInteger(output.rejected_quotes)||output.rejected_quotes<0||output.rejected_quotes>4)throw Error('Invalid source profile output');
 const facts:ProfileFact[]=[],issues:string[]=[];
 if(output.rejected_quotes)issues.push('Some proposed quotations could not be matched to this section.');
 for(const input of output.facts){
  if(!profileKinds.includes(input?.kind)||typeof input?.interpretation!=='string'||!input.interpretation.trim()||input.interpretation.length>300||typeof input?.quote!=='string'||input.quote.trim().length<20||input.quote.length>1000)throw Error('Invalid source profile point');
  let at=chunk.text.indexOf(input.quote);
  while(at>=0&&chunk.text_start+at+input.quote.length<=chunk.cursor)at=chunk.text.indexOf(input.quote,at+1);
  if(at<0)throw Error('The proposed quotation is not in this source section');
  const start=chunk.text_start+at,end=start+input.quote.length;
  if(end<=chunk.cursor||start>=chunk.end)throw Error('The quotation is outside this reading section');
  const interpretation=input.interpretation.trim(),quote=input.quote;
  const markers=quote.toLowerCase().match(/\b(?:unless|except|only|optional|not|no|may|if|choose|either)\b/g)||[];
  const omitted=markers.some(marker=>!new RegExp('\\b'+marker+'\\b','i').test(interpretation));
  const numbers=interpretation.match(/\b\d+(?:\.\d+)?\b/g)||[];
  const added=numbers.some(number=>!new RegExp('\\b'+number.replace('.','\\.')+'\\b').test(quote));
  const dates=interpretation.match(/\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December|today|tomorrow|yesterday)\b/gi)||[];
  const addedDate=dates.some(date=>!new RegExp('\\b'+date+'\\b','i').test(quote));
  const review_issue=omitted?'A source condition or negation was not preserved in the interpretation.':added||addedDate?'A number or date in the interpretation is not present in its quotation.':undefined;
  if(review_issue&&!issues.includes(review_issue))issues.push(review_issue);
  facts.push({kind:input.kind,origin:'local_model',interpretation:review_issue?'':interpretation,start,end,quote_sha256:textHash(body.slice(start,end)),...(review_issue?{review_issue}:{})});
 }
 if(!facts.length)issues.push('No structured points were recovered from this section.');
 return {facts,issues};
}
// Additional verbatim wording prevents a four-point model response from hiding
// a later condition. This is discovery, not an assignment classifier or review.
export function sourceWordings(body:string,chunk:ReturnType<typeof profileChunk>){
 const facts:ProfileFact[]=[];let matches=0;
 const start=body.lastIndexOf('\n',Math.max(0,chunk.cursor-1))+1;
 const until=body.indexOf('\n',chunk.end),text=body.slice(start,until<0?body.length:until);
 for(const match of text.matchAll(/[^\r\n]+/g)){
  const quote=match[0],at=start+match.index!;
  if(at+quote.length<=chunk.cursor||at>=chunk.end||quote.trim().length<20||!/\b(?:must|required|submit|optional|unless|only|choose|rubric|criteria|policy|file format|AI (?:use|usage)|not permitted)\b/i.test(quote))continue;
  matches++;if(facts.length>=20||quote.length>1000)continue;
  facts.push({kind:'wording',origin:'source_wording',interpretation:'',start:at,end:at+quote.length,quote_sha256:textHash(quote)});
 }
 return {facts,limited:matches>facts.length};
}
export function profileQuote(body:string,fact:ProfileFact){
 if(!Number.isSafeInteger(fact.start)||!Number.isSafeInteger(fact.end)||fact.start<0||fact.end<=fact.start||fact.end>body.length||textHash(body.slice(fact.start,fact.end))!==fact.quote_sha256)throw Error('Source profile evidence mismatch');
 const before=body.slice(0,fact.start),start_line=before.split('\n').length,end_line=body.slice(0,fact.end).split('\n').length;
 const units=[...before.matchAll(/^(?:Page|Slide|Paragraph) \d+[^\n]*$/gm)];
 const lineStart=body.lastIndexOf('\n',Math.max(0,fact.start-1))+1,priorStart=body.lastIndexOf('\n',Math.max(0,lineStart-2))+1;
 const lineEnd=body.indexOf('\n',fact.end),nextEnd=lineEnd<0?body.length:body.indexOf('\n',lineEnd+1);
 const contextStart=boundary(body,Math.max(priorStart,fact.start-240)),contextEnd=boundary(body,Math.min(nextEnd<0?body.length:nextEnd,fact.end+240));
 return {...fact,quote:body.slice(fact.start,fact.end),start_line,end_line,unit:units.at(-1)?.[0]||null,context:body.slice(contextStart,Math.max(fact.end,contextEnd))};
}
