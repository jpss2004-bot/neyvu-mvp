import {createHash} from 'node:crypto';
import {profileModel,profileModelDigest} from './profile-evidence';
import {unverifiedForumSource} from './source-authority';
import {exactSourceUnits} from './exact-source-units';

// The relevance policy is part of checkpoint identity, even when exact unit
// boundaries are unchanged. Old selections must not resume under a new policy.
export const sourceReadingAlgorithm='question-source-reading/18';
export const sourceReadingLimit=160000;
type Context={user_id:string;job_id:string;question:string;revision:string};
type Source={id:string;version_id:string;course_id:string;kind:string;title:string;body:string;original_url?:string|null;untrusted?:boolean};
export type SourceReadingRequest=Source&{text_sha256:string;read_scope_sha256:string;untrusted:boolean};
type Section={start:number;end:number;text_start:number;text_end:number};
type Usage={input_tokens:number|null;output_tokens:number|null};
type Quote={start:number;end:number;sha256:string};
export type SourceReadingReceipt={algorithm:string;source_id:string;version_id:string;text_sha256:string;read_scope_sha256:string;question_sha256:string;characters:number;model:string;model_digest:string;cursor:number;processed_sections:Section[];section_usage:Usage[];usage:Usage&{completed_model_requests:number};quotes:Quote[];selected_lines:number[];rejected_selections:number;complete_saved_text_processed:boolean;semantic_reviewed:false;author_authority_verified:false;unverified_forum:boolean};
const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const record=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const integer=(v:unknown,max=Number.MAX_SAFE_INTEGER):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=max;
const unicode=(s:string)=>{for(const c of s){const n=c.codePointAt(0)!;if(n>=0xd800&&n<=0xdfff)return false;}return true;};
const keys=(v:unknown,names:string[])=>record(v)&&Object.keys(v).length===names.length&&names.every(k=>Object.hasOwn(v,k));
function same(a:any,b:any):boolean{
 if(a===b)return true;
 if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((v,i)=>same(v,b[i]));
 if(record(a)&&record(b)){const names=Object.keys(a);return keys(b,names)&&names.every(k=>same(a[k],b[k]));}
 return false;
}
function invalid():never{throw Error('Invalid source reading evidence');}

// This binds an already-authorized text row. Callers must fetch the row inside
// the owning tenant and recheck the active answer lease before storing results.
// The pure constructor does not authenticate a client or query a database.
export function sourceReadingRequest(context:Context,source:Source):SourceReadingRequest{
 if(!context||![context.user_id,context.job_id,source?.id,source?.version_id,source?.course_id].every(uuid)
  ||typeof context.question!=='string'||!context.question.trim()||context.question.length>3000||!unicode(context.question)
  ||typeof context.revision!=='string'||context.revision.length>256||!unicode(context.revision)
  ||!['file','moodle','note'].includes(source.kind)||typeof source.title!=='string'||source.title.length>1000||!unicode(source.title)
  ||typeof source.body!=='string'||source.body.length>sourceReadingLimit||!unicode(source.body)
  ||source.original_url!=null&&(typeof source.original_url!=='string'||source.original_url.length>4000)
  ||source.untrusted!==undefined&&typeof source.untrusted!=='boolean')invalid();
 const full={id:source.id,version_id:source.version_id,course_id:source.course_id,kind:source.kind,title:source.title,body:source.body,original_url:source.original_url??null,untrusted:source.untrusted===true,excerpt:source.body};
 const untrusted=unverifiedForumSource(full);
 const text_sha256=sha(source.body);
 const read_scope_sha256=sha(JSON.stringify([sourceReadingAlgorithm,context.user_id,context.job_id,context.revision,
  sha(context.question),source.id,source.version_id,source.course_id,source.kind,source.title,source.original_url??null,text_sha256,untrusted]));
 const {excerpt:_,...canonical}=full;
 const request={...canonical,untrusted,text_sha256,read_scope_sha256};
 if(Buffer.byteLength(JSON.stringify(request))>1024*1024)invalid();
 return request;
}

const down=(text:string,index:number)=>index>0&&index<text.length&&/[\uDC00-\uDFFF]/.test(text[index])&&/[\uD800-\uDBFF]/.test(text[index-1])?index-1:index;
const up=(text:string,index:number)=>index>0&&index<text.length&&/[\uDC00-\uDFFF]/.test(text[index])&&/[\uD800-\uDBFF]/.test(text[index-1])?index+1:index;
export function sourceReadingSections(body:string):Section[]{
 if(typeof body!=='string'||body.length>sourceReadingLimit||!unicode(body))invalid();
 const result:Section[]=[];
 for(let cursor=0;cursor<body.length;){
  let end=down(body,Math.min(body.length,cursor+6000));
  if(end<body.length){const newline=body.lastIndexOf('\n',end-1);if(newline>=cursor+4000)end=newline+1;}
  result.push({start:cursor,end,text_start:up(body,Math.max(0,cursor-400)),text_end:down(body,Math.min(body.length,end+400))});
  cursor=end;
 }
 if(result.length>64)invalid();
 return result;
}
// Numbered exact source units: short LF lines stay intact; flattened long
// paragraphs can use complete sentence boundaries. Never hard-cut an oversized
// sentence or separate an immediately following qualification from its lead.
// These IDs are reading protocol IDs, not physical document line numbers.
export function sourceReadingUnits(body:string){
 if(typeof body!=='string'||body.length>sourceReadingLimit||!unicode(body))invalid();
 return exactSourceUnits(body);
}

function totalUsage(values:Usage[]){
 const sum=(key:keyof Usage)=>values.some(v=>v[key]===null)?null:values.reduce((sum,v)=>sum+v[key]!,0);
 return {completed_model_requests:values.length,input_tokens:sum('input_tokens'),output_tokens:sum('output_tokens')};
}

// All quotations are reconstructed from the current pinned body. A valid
// receipt records worker observations; it never grants course-author authority.
export function validateSourceReading(request:SourceReadingRequest,question:string,value:unknown,options:{partial?:boolean;budget?:number}={}){
 if(!request||typeof request.body!=='string'||!unicode(request.body)||request.body.length>sourceReadingLimit||request.text_sha256!==sha(request.body)
  ||typeof request.read_scope_sha256!=='string'||! /^[0-9a-f]{64}$/.test(request.read_scope_sha256)
  ||typeof question!=='string'||!question.trim()||question.length>3000||!unicode(question))invalid();
 const identity={algorithm:sourceReadingAlgorithm,source_id:request.id,version_id:request.version_id,
  text_sha256:request.text_sha256,read_scope_sha256:request.read_scope_sha256,question_sha256:sha(question),
  characters:request.body.length,model:profileModel,model_digest:profileModelDigest};
 const names=[...Object.keys(identity),'cursor','processed_sections','section_usage','usage','quotes','selected_lines','rejected_selections',
  'complete_saved_text_processed','semantic_reviewed','author_authority_verified','unverified_forum'];
 if(!keys(value,names))invalid();
 const state=value as SourceReadingReceipt;
 for(const [key,v] of Object.entries(identity))if((state as any)[key]!==v)invalid();
 if(!Array.isArray(state.processed_sections)||state.processed_sections.length>64||!state.processed_sections.every(r=>keys(r,['start','end','text_start','text_end'])&&Object.values(r).every(v=>integer(v,sourceReadingLimit))))invalid();
 const sections=sourceReadingSections(request.body),ranges=state.processed_sections;
 if(!same(ranges,sections.slice(0,ranges.length)))invalid();
 const cursor=ranges.at(-1)?.end??0;
 if(!integer(state.cursor,sourceReadingLimit)||state.cursor!==cursor||!integer(state.rejected_selections,8*ranges.length)
  ||typeof state.complete_saved_text_processed!=='boolean'||state.complete_saved_text_processed!==(ranges.length===sections.length)
  ||state.semantic_reviewed!==false||state.author_authority_verified!==false||typeof state.unverified_forum!=='boolean'||request.untrusted&&!state.unverified_forum)invalid();
 if(!options.partial&&!state.complete_saved_text_processed)invalid();
 if(!Array.isArray(state.section_usage)||state.section_usage.length!==ranges.length||!state.section_usage.every(u=>keys(u,['input_tokens','output_tokens'])&&Object.values(u).every(v=>v===null||integer(v,1000000))))invalid();
 if(!same(state.usage,totalUsage(state.section_usage)))invalid();
 const lines=sourceReadingUnits(request.body),selected=state.selected_lines;
 if(!Array.isArray(selected)||selected.length>Math.min(256,8*ranges.length)||selected.some((n,i)=>!integer(n,lines.length)||n<1||i>0&&n<=selected[i-1]))invalid();
 for(const n of selected){const line=lines[n-1];if(!line.text.trim()||!ranges.some(r=>line.start<r.end&&line.end>r.start))invalid();}
 const quotes=lines.filter(r=>selected.includes(r.line)&&r.end<=cursor).map(r=>({start:r.start,end:r.end,sha256:sha(r.text)}));
 if(!same(state.quotes,quotes))invalid();
 const merged:{start:number;end:number}[]=[];
 for(const q of quotes){const last=merged.at(-1);if(last&&q.start<=last.end)last.end=Math.max(last.end,q.end);else merged.push({start:q.start,end:q.end});}
 const text=merged.map(r=>request.body.slice(r.start,r.end)).join('\n…\n');
 const budget=options.budget??12000;if(!integer(budget,sourceReadingLimit))invalid();
 const context_limited=state.complete_saved_text_processed&&text.length>budget;
 return {receipt:JSON.parse(JSON.stringify(state)) as SourceReadingReceipt,
  excerpt:state.complete_saved_text_processed&&!context_limited?text:null,context_limited,
  authority_verified:false as const,semantic_reviewed:false as const,untrusted:request.untrusted||state.unverified_forum};
}
