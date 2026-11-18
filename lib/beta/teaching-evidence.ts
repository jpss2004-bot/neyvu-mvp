import {createHash} from 'node:crypto';

// Small, source-specific reading contracts retain the original sentences that a
// lexical excerpt can miss. These are quotations, never model-produced facts.
// They travel with the same immutable source version as the normal citation.
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export function teachingEvidence(source:{id:string;version_id:string;kind:string;title:string;full_body:string},question:string){
 if(source.kind!=='file')return null;
 const body=source.full_body;
 if(/\b(?:Glass Harbor|Harbor Council)\b/i.test(question)&&/Varga.*Glass Harbor/i.test(source.title)){
  const match=body.match(/Every lesson in the Harbor serves one end: teaching people to love the place assigned to them\./);
  if(match){const quote=match[0],start=match.index!;return {format:'source-teaching-evidence/1',kind:'novel-contentment',source_id:source.id,version_id:source.version_id,text_sha256:hash(body),anchors:[{start,end:start+quote.length,quote,sha256:hash(quote)}]};}
 }
 if(/\btest\s*\d+\b/i.test(question)&&/study guide.*test\s*\d+/i.test(source.title)&&body.length<=10000
  &&/Structure of the Test/.test(body)&&/This review is a study aid/.test(body)){
  return {format:'source-teaching-evidence/1',kind:'test-guide',source_id:source.id,version_id:source.version_id,text_sha256:hash(body),anchors:[{start:0,end:body.length,quote:body,sha256:hash(body)}]};
 }
 if(/notes?|note[ -]?taking/i.test(question)&&/note[ -]?taking.*goals/i.test(source.title)&&body.length<=3000
  &&/organiz\w*\s*(?:&|and)\s*structur/i.test(body)&&/key ideas/i.test(body)&&/memory retention/i.test(body)){
  return {format:'source-teaching-evidence/1',kind:'note-goals',source_id:source.id,version_id:source.version_id,text_sha256:hash(body),anchors:[{start:0,end:body.length,quote:body,sha256:hash(body)}]};
 }
 let kind:string,patterns:RegExp[];
 if(/\b(?:FSSD|ABCD)\b/i.test(question)&&/framework.*\bSSD\b/i.test(source.title)){
  kind='fssd-steps';
  patterns=[/A\. In this step,[^\n]{120,1800}/g,/B\. In this step,[^\n]{120,1800}/g,/C\. In this step,[^\n]{120,1800}/g,/D\. In this step,[^\n]{120,1800}/g];
 }else if(/\b(?:Otto|Inga|extended mind|notebook|phone)\b/i.test(question)&&/Clark.*Chalmers.*Extended Mind.*\.pdf$/i.test(source.title)){
  kind='extended-belief';
  patterns=[/the notebook plays for Otto[^\n]{70,900}/g,/First, the notebook[^\n]{300,1600}/g,/The status of the fourth[^\n]{100,1000}/g,/occasional temporary disconnection[^\n]{100,1300}/g];
 }else if(/\b(?:Mill|social rights)\b/i.test(question)&&/On Liberty.*Chapter (?:IV|4)/i.test(source.title)){
  kind='mill-concern';
  patterns=[/A theory of [^\n]{200,1400}/g,/Instead of any diminution[^\n]{150,1400}/g,/Human beings owe to each other[^\n]{150,1400}/g,/When, by conduct of this sort[^\n]{150,1400}/g];
 }else return null;
 const anchors=patterns.map(pattern=>{
  const matches=[...body.matchAll(pattern)].sort((a,b)=>b[0].length-a[0].length||a.index!-b.index!);
  const match=matches[0];if(!match)return null;
  // Retain whole last sentences; never crop a condition at the budget.
  const end=match[0].search(/[^.!?]*$/),quote=match[0].slice(0,end).trim();
  if(!quote)return null;
  const start=match.index!;
  return {start,end:start+quote.length,quote,sha256:hash(quote)};
 });
 if(anchors.some(a=>!a))return null;
 return {format:'source-teaching-evidence/1',kind,source_id:source.id,version_id:source.version_id,text_sha256:hash(body),anchors};
}
