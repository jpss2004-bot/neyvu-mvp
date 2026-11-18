import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {PoolClient} from 'pg';
import {tenant,uuid} from './db';
import {lockVault,checkHistory} from './budget';
import {BetaHttpError} from './http';
import {BetaConflict} from './vault';
import {planningScope} from './planning-scope';
import {currentCourseSelection} from './course-selection';
import {workInventoryQuestion} from './chat-intent';
import {sourceBlocks,sourceEvidenceBlocks} from './source-blocks';
import {latePolicyLookupQuestion,latePolicyUnits,syllabusPolicyTitle,possiblePolicyTitle} from './source-policy-units';
import {excerptCoverage} from './excerpt-coverage';
import {sourceReadingAlgorithm,sourceReadingLimit,sourceReadingRequest,validateSourceReading,type SourceReadingReceipt} from './source-reading';
import {savedMaterial,savedSourceCatalogue} from './source-material';

const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
type Entry={index:number;id:string;version_id:string;text_sha256:string;read_scope_sha256:string|null;untrusted:boolean;limited:boolean;state:SourceReadingReceipt|null};
type Plan={algorithm:string;revision:string;selection_revision:string|null;selection_basis?:'planning'|'moodle';entries:Entry[]};
export function referenceLookupQuestion(input:{question?:string;mode?:string}){
 if(input.mode&&input.mode!=='ask')return false;
 const q=input.question||'';if(q.length>500||/\b(?:all|every|entire|whole|summari[sz]e|explain|compare|prepare|analy[sz]e|argument|claims?|meaning|why)\b/i.test(q))return false;
 return /^\s*(?:which|what)\s+(?:[A-Z]{2,5}[ -]?\d{3,4}[A-Z]?\s+)?(?:(?:assigned|saved|course|original)\s+)*(?:reading|article|paper|source|document|file|text|book)\b/i.test(q)&&/\b(?:discuss\w*|examin\w*|cover\w*|address\w*|explor\w*|about)\b/i.test(q);
}
export function compoundActivityFacts(question:string,title:string){
 const named=[...question.matchAll(/\b(assignment|homework|quiz|test|exam|case|report|project)\s+(\d{1,3})\b/gi)];
 if(named.length!==1)return false;
 const facets=[/\b(?:due|deadline|date|when|closes?|closing)\b/i,/\b(?:length|how long|duration|word count|page count|minutes)\b/i,/\b(?:deliver(?:ed|y)?|submit|submission|format|record(?:ed|ing)?|file type)\b/i];
 return facets.filter(pattern=>pattern.test(question)).length>=2&&new RegExp('\\b'+named[0][1]+'[ _-]*'+named[0][2]+'\\b','i').test(title);
}
export function automaticBlankContextScope(input:{question?:string;mode?:string;retrieval_query?:string;context?:unknown[];history?:Array<{role?:string;text?:string}>;source_scope?:{kind?:string}|null}){
 const question=input.question||'';
 const personalOrChanged=/\b(?:notes?|notebooks?|catalogues?|inventor(?:y|ies)|transcripts?|recordings?|announc\w*|changed|changes|latest|notas?|cuadernos?|cat[aá]logos?|inventarios?|transcripciones?|grabaciones?|anuncios?|cambios?|cambi[oó]|novedades)(?![\p{L}\p{N}_])/iu.test(question);
 const priorUser=(input.history||[]).slice(0,-1).some(row=>row.role==='user'&&row.text?.trim());
 const refersBack=priorUser&&/\b(?:it|this|that|these|those|previous|earlier|above|same|esto|eso|esta|esa|estos|esas|anterior|antes|mismo|misma|arriba)\b/i.test(question);
 return !comprehensiveSourceRequest(input)&&!personalOrChanged&&!refersBack&&!input.context?.length&&input.source_scope?.kind!=='selected_only';
}
export function comprehensiveSourceRequest(input:{question?:string;retrieval_query?:string;mode?:string;context?:unknown[]}){
 // A targeted edit of the student's paragraph does not request a complete
 // reading of every incidental search hit. Keep located whole evidence units
 // and their omissions; explicit selections and whole-source requests retain
 // the full reader and all its limits.
 const q=input.question||'';
 if(!input.context?.length&&input.mode!=='solve'
  &&/\b(?:review|revise|edit|rewrite|improve|polish)\b/i.test(q)
  &&/\b(?:paragraph|sentence|wording|phrase)\b/i.test(q)
  &&/\b(?:my|our|current)\b/i.test(q)
  &&! /\b(?:all|every|whole|entire|sources?|instructions?|rubric|checklist)\b/i.test(q))return false;
 if(['plan','study'].includes(input.mode||''))return true;
 // A concrete typed matrix is the problem to solve, not a request to read
 // every incidental course file. Explicit source-reading language below and
 // selected solve-mode sources still retain their original reading scope.
 const typedMatrix=/\[[^\[\]]*\d[^\[\]]*;[^\[\]]*\d[^\[\]]*\]/.test(input.question||'');
 // Two complete, typed numeric equations are also a self-contained practice
 // problem. Named assignments, selected originals and source-wide requests
 // still require their full source-reading path.
 const typedSystem=(q.match(/(?:[+-]?\s*\d*(?:\.\d+)?\s*[xy]\s*[+-]\s*\d*(?:\.\d+)?\s*[xy])\s*=\s*[+-]?\s*\d+(?:\.\d+)?/gi)||[]).length>=2
  &&! /\b(?:assignment|homework|worksheet|sources?|instructions?|rubric|checklist|all|every|entire|whole)\b/i.test(q);
 if(input.mode==='solve'&&!typedMatrix&&!typedSystem)return true;
 const text=[input.question,input.retrieval_query].filter(Boolean).join(' ');
 // "Review" can name an assignment, so require a requested action rather
 // than matching that noun inside a factual due-date/weighting question.
 const action=/(?:^|[.!?;,]\s*|\b(?:and|then|also)\s+)(?:(?:please|can you|could you|would you|help me(?: to)?)\s+)*(?:prepare|compare|synthesi[sz]e|review|analy[sz]e|summari[sz]e|preparar|prep[aá]rame|comparar|sintetizar|revisar|analizar|resumir|resume)\b/i;
 const document=String.raw`(?:(?:this|these|the|my|our|all|every|este|esta|estos|estas|el|la|los|las|mi|mis)\s+)*(?:(?:whole|entire|full|complete|saved|selected|current|assigned|complet[oa]|entero|asignad[oa]s?)\s+)*(?:pdfs?|sources?|documents?|chapters?|files?|readings?|instructions?|syllabus|lectures?|materials?|texts?|notes|policy|art[ií]culos?|lecturas?|fuentes?|documentos?|cap[ií]tulos?|archivos?|materiales|instrucciones)\b`;
 const documentAction=new RegExp(String.raw`(?:^|[.!?;,]\s*|\b(?:and|then|also)\s+)(?:(?:please|can you|could you|would you|help me(?: to)?|I (?:want|need|would like)(?: you)? to|ay[uú]dame a)\s+)*(?:explain|understand|read|leer|lee|lea|walk (?:me|us) through|give (?:me|us) (?:a|an) (?:(?:full|complete|brief|short|concise)\s+)?(?:overview|summary|analysis) of|entender|expl[ií]came|explica(?:me)?|dame (?:un|una) (?:resumen|an[aá]lisis) de)\s+${document}`,'i');
 const documentQuestion=new RegExp(String.raw`(?:^|[.!?;]\s*)\s*(?:what(?:'s| is)\s+${document}\s+(?:is\s+)?about|what(?:'s| is)\s+the\s+(?:main|central)\s+(?:argument|claim|thesis|idea)\s+of\s+${document}|¿?(?:de qu[eé] trata|cu[aá]l es (?:el|la) (?:argumento|idea) (?:principal|central) de)\s+${document})`,'i');
 if(documentAction.test(text)||documentQuestion.test(text)||/\b(?:solve|answer|work through|complete)\s+(?:all|every|the whole|the entire)\b.{0,100}\b(?:questions?|problems?|exercises?|assignments?|files?|pdfs?)\b/i.test(text))return true;
 return action.test(text)||/\b(?:want|need|would like)\s+(?:(?:you|us)\s+to\s+|to\s+)(?:prepare|compare|review|analy[sz]e|summari[sz]e)\b|\b(?:read|leer|lee|lea)\s+(?:(?:this|these|my|the|este|esta|estos|estas)\s+(?:(?:saved|selected|current)\s+)?(?:sources?|documents?|chapters?|instructions?|syllabus|files?|books?|notes|material|texts?)\b|this\s*[.!?]?$)|\b(?:read|leer|lee|lea)\b.{0,100}\b(?:all|every|entire|whole|full|todos?|todas?|complet[oa]|entero)\b|\b(?:all|every)\s+(?:requirements?|instructions?|sources?|materials?|readings?|conditions?|exceptions?)\b|\b(?:todos?|todas?)\s+(?:los?\s+|las?\s+)?(?:requisitos|instrucciones|fuentes|materiales|lecturas|condiciones|excepciones)\b/i.test(text);
}
export function automaticPersonalContextScope(input:{question?:string;retrieval_query?:string;mode?:string;context?:unknown[];source_scope?:{kind?:string}|null}){
 return !input.context?.length&&input.source_scope?.kind!=='selected_only'&&(!input.mode||input.mode==='ask')
  &&!comprehensiveSourceRequest(input)
  &&!latePolicyLookupQuestion(input)
  &&! /\b(?:due|deadlines?|polic(?:y|ies)|permission|allowed|forbidden|requirements?|rubric|grades?|scores?|submissions?|submitted|instructor|teacher|professor|comments?|feedback)\b/i.test(input.question||'')
  &&! /\b(?:notes?|notebooks?|transcripts?|recordings?|what (?:did|have) (?:I|we) (?:write|wrote|record|said))\b/i.test(input.question||'');
}
async function saved(c:PoolClient,user:string,ref:any){
 const row=(await c.query(`SELECT s.id,s.course_id,s.kind,s.title,s.original_url,s.current_version,v.id AS version_id,v.body
 FROM schoolvault.sources s JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.source_id=s.id
 WHERE s.user_id=$1 AND s.id=$2 AND v.id=$3`,[user,ref.id,ref.version_id])).rows[0];
 if(!row)throw new BetaConflict('The saved reading source is unavailable.');
 if(['id','version_id','course_id','kind','title'].some(k=>row[k]!==ref[k])||(row.original_url??null)!==(ref.original_url??null))throw new BetaConflict('The saved reading source changed.');
 return row;
}
function context(user:string,job:any,plan:Plan){return {user_id:user,job_id:job.id,question:job.input.question,revision:plan.revision};}
function replaceExcerpt(ref:any,request:ReturnType<typeof sourceReadingRequest>,checked:ReturnType<typeof validateSourceReading>){
 if(checked.excerpt===null)return;
 ref.excerpt=checked.excerpt;
 ref.excerpt_coverage=excerptCoverage(ref,request.body,checked.excerpt);
 ref.source_material=savedMaterial(request);
 ref.untrusted=!!ref.untrusted||checked.untrusted;
 // Processing every saved-text section does not make the quotations complete,
 // verify the original file, or corroborate the author's institutional role.
 ref.source_reading={algorithm:sourceReadingAlgorithm,read_scope_sha256:request.read_scope_sha256,
  complete_saved_text_processed:true,semantic_reviewed:false,author_authority_verified:false};
}

// Called inside the tenant read-only preparation snapshot. Only pointers
// and bounded checkpoints are stored; full saved text is fetched one source at a time.
export async function planAnswerSourceReadings(c:PoolClient,user:string,job:any,sources:any[],selectionRevision:string|null,selectionBasis:'planning'|'moodle'='moodle'):Promise<Plan|null>{
 const revision=sha(JSON.stringify([job.input.question,job.input.retrieval_query??null,job.input.course_id??null,
  selectionRevision,selectionBasis,sources.map(s=>[s.id,s.version_id,s.course_id,s.kind,s.title,s.original_url??null,!!s.untrusted,s.source_material??null])]));
 const plan:Plan={algorithm:sourceReadingAlgorithm,revision,selection_revision:selectionRevision,selection_basis:selectionBasis,entries:[]};
 const referenceLookup=referenceLookupQuestion(job.input)&&!comprehensiveSourceRequest(job.input)&&!(job.input.context?.length)&&job.input.source_scope?.kind!=='selected_only';
 const policyLookup=latePolicyLookupQuestion(job.input)&&!comprehensiveSourceRequest(job.input)&&!(job.input.context?.length)&&job.input.source_scope?.kind!=='selected_only';
 const narrowAutomatic=automaticBlankContextScope(job.input);
 const otherLocatedOriginal=(ref:any)=>sources.some(other=>other!==ref&&other.course_id===ref.course_id&&!other.untrusted
  &&['file','moodle'].includes(other.kind)&&other.source_material?.kind==='observed_source'&&other.excerpt?.trim()
  &&other.excerpt_coverage?.trace==='exact'&&other.excerpt_coverage.partial_units===0&&other.excerpt_coverage.selected_units>0);
 for(const [index,ref] of sources.entries()){
  if(ref.kind==='ai_draft'||ref.excerpt_coverage?.complete_saved_text)continue;
  // A structured task/receipt overview cites bound saved facts, not a claim
  // to explain the whole syllabus. Explicit attachments/full reading retain
  // the normal reader and its limits.
  if(job.input.work?.plan_format===1&&workInventoryQuestion(job.input.question||'')&&!job.input.context?.length&&job.input.source_scope?.kind!=='selected_only'&&!/\b(?:read|explain|compare|summari[sz]e|analy[sz]e)\b/i.test(job.input.question||'')){
   ref.source_reading_omission={reason:'structured_work_overview',complete_saved_text_processed:false};continue;
  }
  // A title/topic lookup can use another actual matched source. An automatic
  // blank hit contributes no quoted facts and must not force a whole incidental
  // notebook through the reader. Explicit selections, broad reading, and a
  // lookup with no other whole located evidence retain the existing reader.
  if(referenceLookup&&!ref.excerpt?.trim()&&sources.some(other=>other.course_id===ref.course_id&&!other.untrusted&&['file','moodle'].includes(other.kind)&&other.excerpt?.trim()&&other.excerpt_coverage?.trace==='exact'&&other.excerpt_coverage.partial_units===0&&other.excerpt_coverage.selected_units>0))continue;
  // A complete located syllabus rule answers a narrow general policy lookup.
  // Do not read a blank incidental notebook for it, but keep a blank competing
  // syllabus, explicit selections and questions about later changes in scope.
  if(policyLookup&&!ref.excerpt?.trim()&&ref.kind!=='moodle'&&!possiblePolicyTitle.test(ref.title)&&sources.some(other=>{
   const coverage=other.excerpt_coverage,body=other.excerpt||'';
   return other.course_id===ref.course_id&&!other.untrusted&&other.kind==='file'&&syllabusPolicyTitle.test(other.title)
    &&(['exact-section-groups/6','exact-section-groups/7','exact-section-groups/8'].includes(coverage?.unit_algorithm)||coverage?.complete_saved_text===true)&&coverage.trace==='exact'&&coverage.partial_units===0&&coverage.selected_units===1
    &&latePolicyUnits(body).some(unit=>unit.start===0&&unit.end===body.length);
  }))continue;
  const row=await saved(c,user,ref);
  if(!row.body.trim())continue;
  // A conceptual follow-up does not request a full audit of every old draft
  // retrieved automatically. Its existing located excerpt stays personal,
  // partial context. Selected notes and explicit whole-source requests still
  // use the complete reader; no authority or full-read label is added here.
  if(automaticPersonalContextScope(job.input)&&ref.excerpt?.trim()&&savedMaterial(row).kind==='student_notes'){
   ref.source_reading_omission={reason:'automatic_personal_context',complete_saved_text_processed:false};
   continue;
  }
  // Empty automatic notebook/catalogue hits have no located wording for this
  // question. They must not force a whole-source read beside actual original
  // passages. With no alternative, an explicit selection or a full reading
  // request, keep the reader. No existing quotation or condition is cropped.
  if(narrowAutomatic&&!ref.excerpt?.trim()&&otherLocatedOriginal(ref)
   &&(savedMaterial(row).kind==='student_notes'||savedSourceCatalogue(row))){
   ref.source_reading_omission={reason:'automatic_blank_context',complete_saved_text_processed:false};
   continue;
  }
  const originalBlocks=[...sourceBlocks(row.body)];
  // Preserve the existing bounded structural-excerpt path (for example, a
  // complete office-hours section inside a short wrapped source).
  if(ref.excerpt?.trim()&&!originalBlocks.some(b=>b.text.length>1800))continue;
  // A multi-part question about a named activity needs that activity's own
  // details together. Its date-only tail cannot stand in for duration, format
  // and delivery instructions elsewhere in the same original.
  const policyTooLarge=policyLookup&&syllabusPolicyTitle.test(ref.title)&&latePolicyUnits(row.body).map(unit=>unit.text.trim()).join('\n…\n').length>1800;
  const selectedSolve=job.input.mode==='solve'&&Array.isArray(job.input.context)&&job.input.context.includes(ref.id);
  const comprehensive=comprehensiveSourceRequest(job.input)||selectedSolve||policyTooLarge||['file','moodle'].includes(ref.kind)&&compoundActivityFacts(job.input.question,ref.title),blocks=[...(comprehensive?originalBlocks:sourceEvidenceBlocks(row.body))];
  const coverage=ref.excerpt_coverage;
  const wholeExcerpt=coverage?.trace==='exact'&&coverage.partial_units===0&&coverage.selected_units>0;
  // Broad reading retains the original requirement. A narrow query may use
  // complete located evidence units even when a different, omitted unit is
  // oversized. Source-wide size is not evidence that this exact excerpt was
  // cut. Omissions stay explicit; no full-read/semantic claim is attached.
  if(ref.excerpt?.trim()&&(comprehensive?!blocks.some(b=>b.text.length>1800):wholeExcerpt))continue;
  const limited=row.body.length>sourceReadingLimit;
  const request=limited?null:sourceReadingRequest(context(user,job,plan),{...row,untrusted:!!ref.untrusted});
  const entry:Entry={index,id:row.id,version_id:row.version_id,text_sha256:sha(row.body),read_scope_sha256:request?.read_scope_sha256??null,untrusted:!!ref.untrusted,limited,state:null};
  const previous=job.input.source_readings;
  const old=previous?.algorithm===plan.algorithm&&previous.revision===revision?previous.entries?.find((e:Entry)=>e.read_scope_sha256===entry.read_scope_sha256&&e.id===entry.id&&e.version_id===entry.version_id):null;
  if(request&&old?.state){
   const checked=validateSourceReading(request,job.input.question,old.state,{partial:true});entry.state=checked.receipt;replaceExcerpt(ref,request,checked);
  }
  plan.entries.push(entry);
 }
 return plan.entries.length?plan:null;
}

async function withLease<T>(raw:unknown,fn:(c:PoolClient,user:string,job:any,plan:Plan)=>Promise<T>){
 if(typeof raw!=='string')throw new BetaHttpError('Invalid worker lease');
 const parts=raw.split('.');if(parts.length!==3||!uuid(parts[0])||!uuid(parts[1])||!/^[A-Za-z0-9_-]{43}$/.test(parts[2]))throw new BetaHttpError('Invalid worker lease');
 const [user,id]=parts;
 return tenant(user,async c=>{
  await lockVault(c,user);
  if(!(await c.query('SELECT id FROM schoolvault.users WHERE id=$1 AND disabled_at IS NULL',[user])).rowCount)throw new BetaHttpError('Account unavailable.',403);
  const job=(await c.query('SELECT * FROM schoolvault.jobs WHERE user_id=$1 AND id=$2 FOR UPDATE',[user,id])).rows[0];
  if(!job||job.kind!=='answer'||job.status!=='leased'||job.lease_hash!==sha(raw)||Date.parse(job.lease_until)<=Date.now())throw new BetaConflict('This worker lease expired.');
  const chat=(await c.query('SELECT archived FROM schoolvault.chats WHERE user_id=$1 AND id=$2',[user,job.chat_id])).rows[0];
  if(!chat||chat.archived)throw new BetaConflict('This conversation is unavailable.');
  const plan=job.input.source_readings as Plan;
  if(!plan||plan.algorithm!==sourceReadingAlgorithm||!Array.isArray(plan.entries)||plan.entries.length>30)throw new BetaConflict('No reading was planned for this answer.');
  await currentPlan(c,user,plan);
  return fn(c,user,job,plan);
 });
}
async function currentPlan(c:PoolClient,user:string,plan:Plan){
 const revision=plan.selection_basis==='planning'?(await planningScope(c,user)).binding_revision:(await currentCourseSelection(c,user)).revision;
 if(revision!==plan.selection_revision)throw new BetaConflict('The current course selection changed. Ask again to use the new selection.');
}
async function bound(c:PoolClient,user:string,job:any,plan:Plan,entry:Entry){
 const ref=job.input.sources?.[entry.index];
 if(!ref||ref.id!==entry.id||ref.version_id!==entry.version_id)throw new BetaConflict('The answer source selection changed.');
 const row=await saved(c,user,ref);
 if(row.current_version!==row.version_id&&job.input.context_versions?.[row.id]!==row.version_id)throw new BetaConflict('The source version changed. Ask again to read the current version.');
 if(sha(row.body)!==entry.text_sha256)throw new BetaConflict('The saved source text changed.');
 if(!isDeepStrictEqual(ref.source_material,savedMaterial(row)))throw new BetaConflict('The saved source material label changed.');
 if(entry.limited)return {ref,request:null};
 const request=sourceReadingRequest(context(user,job,plan),{...row,untrusted:entry.untrusted});
 if(request.read_scope_sha256!==entry.read_scope_sha256)throw new BetaConflict('The reading context changed.');
 return {ref,request};
}
export async function nextAnswerSourceReading(raw:unknown){
 return withLease(raw,async(c,user,job,plan)=>{
  for(const entry of plan.entries){
   const {request}=await bound(c,user,job,plan,entry);
   if(!request)return {done:false,context_limited:true};
   const checked=entry.state?validateSourceReading(request,job.input.question,entry.state,{partial:true}):null;
   if(checked?.context_limited)return {done:false,context_limited:true};
   if(!checked?.receipt.complete_saved_text_processed)return {done:false,reading:{source:request,question:job.input.question,checkpoint:checked?.receipt??null}};
  }
  return {done:true,sources:job.input.sources};
 });
}
export async function saveAnswerSourceReading(raw:unknown,scope:unknown,value:unknown){
 if(typeof scope!=='string'||! /^[a-f0-9]{64}$/.test(scope))throw new BetaHttpError('Invalid reading scope');
 return withLease(raw,async(c,user,job,plan)=>{
  const entry=plan.entries.find(e=>e.read_scope_sha256===scope);
  if(!entry)throw new BetaConflict('This reading belongs to a different answer.');
  const {ref,request}=await bound(c,user,job,plan,entry);if(!request)throw new BetaConflict('This saved source exceeds the reader limit.');
  let checked:ReturnType<typeof validateSourceReading>;
  try{checked=validateSourceReading(request,job.input.question,value,{partial:true});}catch{throw new BetaHttpError('Invalid source reading evidence');}
  const old=entry.state,next=checked.receipt,prior=old?.processed_sections.length??0;
  if(old&&isDeepStrictEqual(old,next))return {saved:true,complete:old.complete_saved_text_processed};
  if(old?.complete_saved_text_processed||next.processed_sections.length!==prior+1
   ||old&&(!isDeepStrictEqual(next.processed_sections.slice(0,prior),old.processed_sections)
    ||!isDeepStrictEqual(next.section_usage.slice(0,prior),old.section_usage)
    ||old.selected_lines.some(n=>!next.selected_lines.includes(n))||next.rejected_selections<old.rejected_selections
    ||old.unverified_forum&&!next.unverified_forum))throw new BetaConflict('This reading checkpoint is stale or skips saved progress.');
  entry.state=next;replaceExcerpt(ref,request,checked);
  await c.query("UPDATE schoolvault.jobs SET input=input||$3::jsonb WHERE user_id=$1 AND id=$2",[user,job.id,JSON.stringify({source_readings:plan,sources:job.input.sources})]);
  await checkHistory(c,user);
  return {saved:true,complete:next.complete_saved_text_processed,context_limited:checked.context_limited};
 });
}
// This gate runs in the same locked transaction as draft/final publication.
// Older workers cannot publish around a newly planned reading requirement.
export async function assertAnswerSourcesRead(c:PoolClient,user:string,job:any){
 const plan=job.input.source_readings as Plan|null;if(!plan)return null;
 if(plan.algorithm!==sourceReadingAlgorithm||!Array.isArray(plan.entries)||plan.entries.length>30)throw new BetaConflict('The reading plan is invalid.');
 const chat=(await c.query('SELECT archived FROM schoolvault.chats WHERE user_id=$1 AND id=$2',[user,job.chat_id])).rows[0];
 if(!chat||chat.archived)throw new BetaConflict('This conversation is unavailable.');
 await currentPlan(c,user,plan);
 const usage:{completed_model_requests:number;input_tokens:number|null;output_tokens:number|null}={completed_model_requests:0,input_tokens:0,output_tokens:0};
 for(const entry of plan.entries){
  const {ref,request}=await bound(c,user,job,plan,entry);
  if(!request||!entry.state)throw new BetaConflict('Read the required saved sources before publishing.');
  const checked=validateSourceReading(request,job.input.question,entry.state);
  if(checked.context_limited||checked.excerpt!==ref.excerpt||checked.untrusted&&!ref.untrusted)throw new BetaConflict('The complete reading does not fit this answer.');
  usage.completed_model_requests+=checked.receipt.usage.completed_model_requests;
  for(const k of ['input_tokens','output_tokens'] as const)usage[k]=usage[k]===null||checked.receipt.usage[k]===null?null:usage[k]!+checked.receipt.usage[k]!;
 }
 return usage;
}
