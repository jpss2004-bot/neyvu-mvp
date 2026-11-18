import {digest,type ClassSegment} from './class-recording-format';
import {classMaterialTerms,classMaterialWindows,unverifiedMaterialRange} from './class-material-windows';
export const cornellAlgorithm='class-cornell-v1';
export type SpeechUnit={id:string;segment:number;start_ms:number;end_ms:number;text:string;uncertain:boolean};
export type MaterialPassage={id:string;source_id:string;version_id:string;title:string;kind:string;authority:string;start:number;end:number;unit:string|null;text:string;sha256:string;limitations:string[]};
export function speechUnits(segments:ClassSegment[]):SpeechUnit[]{
 const units:SpeechUnit[]=[];
 for(const [index,segment] of segments.entries()){
  let cursor=0,part=0;
  while(cursor<segment.text.length){let end=Math.min(segment.text.length,cursor+1400);if(end<segment.text.length){const space=segment.text.lastIndexOf(' ',end);if(space>cursor+900)end=space;else if(/[\uDC00-\uDFFF]/.test(segment.text[end]))end--;}
   units.push({id:`T${index}.${part++}`,segment:index,start_ms:segment.start_ms,end_ms:segment.end_ms,text:segment.text.slice(cursor,end),uncertain:segment.uncertain});cursor=end;
  }
 }
 return units;
}
export function cornellChunk(units:SpeechUnit[],cursor:number){
 if(!Number.isSafeInteger(cursor)||cursor<0||cursor>=units.length)throw Error('Invalid Cornell cursor');
 let end=cursor,size=0;while(end<units.length&&size+units[end].text.length<=3200&&end-cursor<80){size+=units[end].text.length;end++;}
 // A question/antecedent and its clarification can straddle a checkpoint.
 // Keep whole neighboring units separately from the speech being processed.
 let before=cursor,after=end,beforeSize=0,afterSize=0;
 while(before>0&&cursor-before<8&&beforeSize+units[before-1].text.length<=1400){before--;beforeSize+=units[before].text.length;}
 while(after<units.length&&after-end<8&&afterSize+units[after].text.length<=1400){afterSize+=units[after].text.length;after++;}
 return {cursor,next_cursor:end,units:units.slice(cursor,end),context:{before:units.slice(before,cursor),after:units.slice(end,after),before_truncated:before>0,after_truncated:after<units.length}};
}
export function materialPassages(rows:{id:string;version_id:string;title:string;kind:string;body:string;limitations:string[]}[],units:SpeechUnit[]):MaterialPassage[]{
 const terms=classMaterialTerms(units.map(u=>u.text).join(' '));
 const candidates:{matched:string[];row:typeof rows[number];window:ReturnType<typeof classMaterialWindows>[number]}[]=[];
 for(const row of rows){
  for(const window of classMaterialWindows(row.body)){
   const {start,end}=window,text=row.body.slice(start,end),words=new Set(classMaterialTerms(text));
   const matched=terms.filter(term=>words.has(term));if(matched.length<2)continue;
   candidates.push({matched,row,window});
  }
 }
 // Cover more than one topic, including separate pages of the same original.
 // This is lexical candidate selection, not a claim of semantic understanding.
 const selected:MaterialPassage[]=[],covered=new Set<string>();
 while(selected.length<3){
  const eligible=candidates.filter(c=>!selected.some(p=>p.source_id===c.row.id&&p.start<c.window.end&&c.window.start<p.end));
  const score=(c:typeof candidates[number])=>c.matched.reduce((n,t)=>n+(covered.has(t)?0.25:1),0);
  eligible.sort((a,b)=>score(b)-score(a)||b.matched.length-a.matched.length||a.row.id.localeCompare(b.row.id)||a.window.start-b.window.start);
  const best=eligible[0];if(!best)break;
  const {row,window:{start,end,unit,partial_sentence}}=best,text=row.body.slice(start,end);
  selected.push({id:row.id+':'+start,source_id:row.id,version_id:row.version_id,title:row.title,kind:row.kind,authority:row.kind==='note'?'student_notes':'observed_source',start,end,unit,text,sha256:digest(text),limitations:[...row.limitations,...(partial_sentence?['This excerpt contains only part of a long sentence. Other clauses may change its meaning; inspect the original before relying on it.']:[])]});for(const term of best.matched)covered.add(term);
 }
 return selected;
}
function text(value:unknown,limit:number,empty=false){if(typeof value!=='string'||value.includes('\0')||value.length>limit||!empty&&!value.trim())throw Error('Invalid Cornell note text');return value.trim();}
function list(value:unknown,limit:number,max:number){if(!Array.isArray(value)||value.length>max)throw Error('Invalid Cornell note list');return value.map(v=>text(v,limit));}
const comparisonText={
 clarifies:'Proposed comparison: the saved passage clarifies the quoted class idea. This comparison has not been reviewed.',
 qualifies:'Proposed comparison: the saved passage adds a qualification to the quoted class idea. This comparison has not been reviewed.',
 differs:'Proposed comparison: the two passages may differ. Compare both originals before relying on either interpretation.',
 unresolved:'The relationship remains unresolved. The saved passage does not establish the missing class wording, visual or reference.',
};
function pairedEvidence(ref:any,chunk:ReturnType<typeof cornellChunk>){
 if(ref.class_unit===undefined&&ref.class_quote===undefined&&ref.relationship===undefined)return {};
 const unit=chunk.units.find(u=>u.id===ref.class_unit),quote=text(ref.class_quote,900),relationship=ref.relationship as keyof typeof comparisonText;
 if(!unit||!unit.text.includes(quote)||!Object.hasOwn(comparisonText,relationship))throw Error('Cornell material comparison is not bound to this class wording');
 if(/not visible|cannot remember|can.t remember|not (?:yet )?identified|remains? unresolved|unclear|inaudible|shown graphically/i.test(quote+' '+ref.quote)&&relationship!=='unresolved')throw Error('A material comparison cannot resolve missing class wording or visuals');
 if(ref.explanation!==comparisonText[relationship])throw Error('A paired material comparison cannot add a free-form conclusion');
 return {relationship,class_evidence:{unit:unit.id,segment:unit.segment,start_ms:unit.start_ms,end_ms:unit.end_ms,quote,quote_sha256:digest(quote),uncertain:unit.uncertain,speaker:'unidentified'}};
}
export function validateCornellSection(chunk:ReturnType<typeof cornellChunk>,materials:MaterialPassage[],output:any){
 if(!output||!Array.isArray(output.topics)||output.topics.length>3)throw Error('Invalid Cornell section');
 const gaps=list(output.gaps,600,6),summary=text(output.summary,1400,true),allInterpretations=[summary,...gaps,...output.topics.flatMap((t:any)=>[t.cue,t.explanation,...(t.connections||[]).map((r:any)=>r.explanation)])].join(' ');
 const neighbors=[...(chunk.context?.before||[]),...(chunk.context?.after||[])];
 const suppliedText=[...chunk.units.map(u=>u.text),...neighbors.map(u=>u.text),...materials.map(p=>p.text)].join(' ');
 if(/\bdeadline\b/i.test(allInterpretations)&&!/\bdeadline\b/i.test(suppliedText))throw Error('A class interpretation introduced an unsupported deadline claim');
 if(/\bhypothetical\b/i.test(suppliedText)&&/\b(?:no obligation exists|(?:actual |official )?policy (?:does not|doesn.t) require|confirms? no (?:requirement|obligation))\b/i.test(allInterpretations))throw Error('A hypothetical example cannot establish a general submission policy');
 if(/\bhypothetical\b/i.test(suppliedText)&&/\b(?:negat(?:e|es|ed|ing) (?:a |the )?(?:universal )?obligation|recording[^.!?]{0,100}(?:not (?:required|mandatory|a requirement)|no obligation)|(?:not required|not mandatory)[^.!?]{0,100}recording)\b/i.test(allInterpretations))throw Error('A hypothetical recording question cannot establish an actual obligation or exemption');
 const commonError=/\bcommon (?:(?:student|learner|beginner) )?(?:error|mistake|misconception|misunderstanding|oversight)\b/i;
 if(commonError.test(allInterpretations)&&!commonError.test(suppliedText))throw Error('A single class correction cannot establish a common error');
 const negatedCause=/\b(?:does|do|did|can|will|would)\s+not\s+(?:prove|ensure|guarantee)|\bnot\s+(?:proven|guaranteed|ensured)|\b(?:prove|ensure|guarantee)\w*\b[^.!?]{0,150}[.?]\s*No\b/i.test(suppliedText);
 for(const verb of ['ensur(?:e|es|ed|ing)','guarantee(?:s|d|ing)?'])for(const match of allInterpretations.matchAll(new RegExp('\\b'+verb+'\\b','gi'))){
  if(new RegExp('\\b'+verb+'\\b','i').test(suppliedText))continue;
  const before=allInterpretations.slice(Math.max(0,match.index!-40),match.index);
  if(negatedCause&&/\b(?:does|do|did|can|will|would)\s+not\s+(?:always\s+)?$|\bnever\s+$/i.test(before))continue;
  throw Error('A class interpretation strengthens a claim beyond its quoted evidence');
 }

 const interpretationNumbers:string[]=allInterpretations.match(/\b\d+(?:\.\d+)?\b/g)||[];if(interpretationNumbers.some(n=>!new RegExp('\\b'+n.replace('.','\\.')+'\\b').test(suppliedText)))throw Error('A class synthesis includes an unverified number absent from the supplied evidence');
 if(/(?:open[- ]ended|flexible (?:timeline|deadline)|no deadline exists|no time constraint|submit at any time|not required to submit|need not submit)/i.test(allInterpretations))throw Error('An absent deadline cannot establish flexible or optional work');
 // An unannounced/unrecorded date says nothing about whether a deadline is
 // binding or enforced. Exact quotes do not validate that extra inference.
 const missingAnnouncement=/\b(?:have not|has not|not|no) announced\b|\bno recorded deadline\b|\bno deadline (?:has|have) been announced\b/i.test(suppliedText);
 const absentEnforcement=/\bno (?:enforced|binding|mandatory|applicable|fixed|strict) deadlines?\b|\bdeadlines? (?:is|are|was|were) not (?:enforced|binding|mandatory|applicable)\b/gi;
 for(const match of allInterpretations.matchAll(absentEnforcement)){
  if(!missingAnnouncement)continue;
  const before=allInterpretations.slice(Math.max(0,match.index!-120),match.index);
  if(/\b(?:does|do) not (?:imply|mean|establish|show|indicate|prove) (?:that )?(?:there (?:is|are) )?$/i.test(before))continue;
  throw Error('An unannounced deadline cannot establish absent enforcement');
 }
 // A report's "recorded deadline" is not an audio-recording obligation.
 // Preserve denials of the inference, while holding assertions of exemption.
 if(/\bhypothetical\b/i.test(suppliedText))for(const match of allInterpretations.matchAll(/\bno (?:actual )?(?:audio )?recording (?:submission )?(?:requirement|obligation)\b/gi)){
  const before=allInterpretations.slice(Math.max(0,match.index!-120),match.index);
  if(/\b(?:does|do) not (?:imply|mean|establish|show|indicate|prove) (?:that )?(?:there (?:is|are) )?$/i.test(before))continue;
  throw Error('A hypothetical question cannot establish absence of a recording requirement');
 }
 for(const match of allInterpretations.matchAll(/\btiming is unrestricted\b/gi)){
  const before=allInterpretations.slice(Math.max(0,match.index!-100),match.index);
  const unannounced=/\b(?:have not|not|no) announced\b|\bno recorded deadline\b/i.test(suppliedText);
  if(unannounced&&/\bdoes not (?:imply|establish|mean) (?:that )?(?:submission )?$/i.test(before))continue;
  throw Error('An absent deadline cannot establish flexible or optional work');
 }
 if(/(?:recorded (?:time|date)|recording time|class date).{0,80}\b(?:in the future|hypothetical|simulated)\b/i.test(allInterpretations))throw Error('Class timing does not establish a hypothetical or future recording');
 if(/\b(?:instructor|professor|teacher|lecturer) (?:explicitly |directly )?(?:said|says|states|stated|clarif\w*|announc\w*|explain\w*|respond\w*|denies|denied|reject\w*|confirms?|defin\w*|demonstrat\w*|taught|correct\w*|notes|noted)\b|\b(?:defined|explained|demonstrated|stated|clarified|announced|taught|confirmed|corrected) by (?:the )?(?:instructor|professor|teacher|lecturer)\b/i.test(allInterpretations))throw Error('Unidentified speech cannot acquire an instructor identity');
 if(summary.length===1400&&!/[.!?]$/.test(summary))throw Error('Cornell synthesis may be cut off; accepted sections are kept');
 const topics=output.topics.map((topic:any)=>{
  const cue=text(topic.cue,240),explanation=text(topic.explanation,6000),examples=list(topic.examples,900,80),questions=list(topic.questions,900,80),conditions=list(topic.conditions,900,80);
  if([...examples,...questions,...conditions].some(value=>!chunk.units.some(unit=>unit.text.includes(value))))throw Error('Cornell class details must retain exact speech wording');
  if(!Array.isArray(topic.evidence)||!topic.evidence.length||topic.evidence.length>80||!Array.isArray(topic.connections)||topic.connections.length>3)throw Error('Cornell topics require bounded evidence');
  const evidence=topic.evidence.map((ref:any)=>{const unit=chunk.units.find(u=>u.id===ref?.unit),quote=text(ref?.quote,1400);if(!unit||!unit.text.includes(quote))throw Error('Cornell speech quote is not in this class section');return {unit:unit.id,segment:unit.segment,start_ms:unit.start_ms,end_ms:unit.end_ms,quote,quote_sha256:digest(quote),uncertain:unit.uncertain,speaker:'unidentified'};});
  // Older accepted drafts remain readable. New reader output retains a source
  // range for every explanation rather than only one large evidence block.
  let teaching_points:any[]|undefined;
  if(topic.teaching_points!==undefined){
   if(!Array.isArray(topic.teaching_points)||!topic.teaching_points.length||topic.teaching_points.length>80)throw Error('Invalid Cornell teaching passages');
   const positions=new Map<string,number>();let previousUnit=-1;
   teaching_points=topic.teaching_points.map((point:any)=>{
    const index=chunk.units.findIndex(u=>u.id===point?.unit),unit=chunk.units[index];
    if(!unit||!evidence.some((ref:any)=>ref.unit===unit.id)||index<previousUnit||!Number.isSafeInteger(point.start)||!Number.isSafeInteger(point.end)||point.start<0||point.end<=point.start||point.end>unit.text.length||/[\uDC00-\uDFFF]/.test(unit.text[point.start]||'')||/[\uDC00-\uDFFF]/.test(unit.text[point.end]||''))throw Error('Cornell teaching passage does not match its transcript range');
    const previous=positions.get(unit.id)||0;
    if(point.start<previous||unit.text.slice(previous,point.start).trim()||typeof point.quote!=='string'||!point.quote.trim()||unit.text.slice(point.start,point.end)!==point.quote)throw Error('Cornell teaching passages must retain exact ordered speech without gaps');
    previousUnit=index;positions.set(unit.id,point.end);
    const interpretation=text(point.explanation,350);if(interpretation.length===350&&!/[.!?]["'’”)\]]*$/u.test(interpretation))throw Error('Cornell teaching explanation may be cut off; accepted sections are kept');
    return {unit:unit.id,segment:unit.segment,start:point.start,end:point.end,quote:point.quote,quote_sha256:digest(point.quote),explanation:interpretation,start_ms:unit.start_ms,end_ms:unit.end_ms,uncertain:unit.uncertain,speaker:'unidentified',reviewed:false};
   });
   if(evidence.some((ref:any)=>{const unit=chunk.units.find(u=>u.id===ref.unit)!;return !positions.has(unit.id)||unit.text.slice(positions.get(unit.id)).trim();})||teaching_points.map(p=>p.explanation).join('\n\n')!==explanation)throw Error('Cornell teaching explanations must retain complete source coverage and match the saved explanation');
  }
  const connections=topic.connections.map((ref:any)=>{const passage=materials.find(p=>p.id===ref?.material),quote=text(ref?.quote,900);if(!passage||!passage.text.includes(quote))throw Error('Cornell material quote is not in its saved passage');if(passage.limitations.some(v=>v.includes('part of a long sentence'))&&ref.relationship!=='unresolved')throw Error('A partial sentence cannot establish a resolved material comparison');const relativeStart=passage.text.indexOf(quote);if(unverifiedMaterialRange(passage.text,relativeStart,relativeStart+quote.length)&&ref.relationship!=='unresolved')throw Error('An unverified formula cannot establish a resolved material comparison');const start=passage.start+relativeStart;return {source_id:passage.source_id,version_id:passage.version_id,title:passage.title,kind:passage.kind,authority:passage.authority,start,end:start+quote.length,unit:passage.unit,quote,quote_sha256:digest(quote),explanation:text(ref.explanation,900),...pairedEvidence(ref,chunk),limitations:passage.limitations,reviewed:false};});
  if(/(?:open[- ]ended|flexible (?:timeline|deadline)|not required to submit|need not submit)/i.test(explanation+' '+connections.map((r:any)=>r.explanation).join(' ')))throw Error('An absent deadline cannot establish flexible or optional work');
  const anchors=[...evidence.map((r:any)=>r.quote),...neighbors.map(u=>u.text),...connections.map((r:any)=>r.quote)].join(' '),interpretation=[cue,explanation,...examples,...questions,...conditions,...connections.map((r:any)=>r.explanation)].join(' '),issues=[];
  const numbers:string[]=interpretation.match(/\b\d+(?:\.\d+)?\b/g)||[];if(numbers.some(n=>!new RegExp('\\b'+n.replace('.','\\.')+'\\b').test(anchors)))throw Error('An interpretation includes an unverified number absent from its quotations');
  const explanationText=[cue,explanation,...connections.map((r:any)=>r.explanation)].join(' ');
  const conditionsPresent=anchors.match(/\b(?:unless|except|optional|not|only|if|may)\b/gi)||[];if(conditionsPresent.some(word=>!new RegExp('\\b'+word+'\\b','i').test(explanationText)))issues.push('A quotation has a condition or negation that needs comparison with the explanation.');
  if(evidence.some((r:any)=>r.uncertain))issues.push('Supporting speech is uncertain; replay the audio.');
  if(neighbors.some(u=>u.uncertain))issues.push('Neighboring speech used for interpretation is uncertain; replay the surrounding audio.');
  return {cue,explanation,examples,questions,conditions,evidence,connections,issues,...(teaching_points?{teaching_points}:{}),reviewed:false};
 });
 if(topics.length&&chunk.units.some(unit=>!topics.some((topic:any)=>topic.evidence.some((ref:any)=>ref.unit===unit.id&&ref.quote===unit.text.trim()))))throw Error('Cornell notes must retain every supplied speech unit');
 if(!topics.length&&!gaps.length)throw Error('A Cornell section needs explanations or an explicit coverage gap');
 const contextualEvidence=(values:SpeechUnit[])=>values.map(u=>({unit:u.id,segment:u.segment,start_ms:u.start_ms,end_ms:u.end_ms,quote:u.text,quote_sha256:digest(u.text),uncertain:u.uncertain,speaker:'unidentified'}));
 const context={before:contextualEvidence(chunk.context?.before||[]),after:contextualEvidence(chunk.context?.after||[]),before_truncated:chunk.context?.before_truncated===true,after_truncated:chunk.context?.after_truncated===true};
 return {cursor:chunk.cursor,next_cursor:chunk.next_cursor,topics,summary,gaps,context,reviewed:false};
}
const clock=(ms:number)=>`${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;
export function cornellBody(title:string,session:any,sections:any[],limitations:string[],sectionStart=0){
 const parts=[`# ${title}\n\nAI-written Cornell study draft. Review speech, explanations and course connections against their originals. Speakers are unidentified; no official deadline, submission, grade or permission is established here.\n\nClass: ${session.recorded_at}; timezone: ${session.timezone}. Capture outcome: ${session.capture_outcome||'unknown'}.\n\nOriginal recording and complete corrected transcript remain available in Class recordings. Processing every saved speech section does not establish complete class coverage or understanding.`];
 parts.push('## Coverage and unresolved evidence\n\n'+[...new Set(limitations)].map(s=>'- '+s).join('\n'));
 for(const [i,section] of sections.entries()){
  parts.push(`## Class section ${i+1+sectionStart}\n\n${section.summary?'Section synthesis (AI interpretation): '+section.summary:''}`);
  if(section.context){const adjacent=[...section.context.before,...section.context.after];if(adjacent.length)parts.push('#### Neighboring speech used for interpretation\n\n'+adjacent.map((r:any)=>`- ${clock(r.start_ms)}–${clock(r.end_ms)}${r.uncertain?' · uncertain speech':''} · unidentified speaker: ${JSON.stringify(r.quote)}`).join('\n'));if(section.context.before_truncated||section.context.after_truncated)parts.push('The context window is bounded. Other clarifications may appear elsewhere in the complete transcript.');}
  for(const topic of section.topics){parts.push(`### Cue: ${topic.cue}`);
   if(topic.teaching_points?.length)parts.push('#### Explanation passages and their class evidence\n\n'+topic.teaching_points.map((p:any)=>`AI interpretation: ${p.explanation}\n\nClass wording · ${clock(p.start_ms)}–${clock(p.end_ms)} · transcript characters ${p.start}–${p.end}${p.uncertain?' · uncertain speech':''} · unidentified speaker: ${JSON.stringify(p.quote)}`).join('\n\n'));else parts.push(topic.explanation);
   for(const [name,key] of [['Examples and method','examples'],['Class questions and corrections','questions'],['Conditions and limits','conditions']] as const)if(topic[key].length)parts.push(`#### ${name}\n\n`+topic[key].map((s:string)=>'- '+s).join('\n'));
   parts.push('#### Class evidence\n\n'+topic.evidence.map((r:any)=>`- ${clock(r.start_ms)}–${clock(r.end_ms)}${r.uncertain?' · uncertain speech':''} · unidentified speaker: ${JSON.stringify(r.quote)}`).join('\n'));
   if(topic.connections.length)parts.push('#### Course material connections (AI interpretation)\n\n'+topic.connections.map((r:any)=>`- [${r.title}](/beta?tab=sources&source=${r.source_id}&version=${r.version_id}) · ${r.unit||'saved text'} · characters ${r.start}–${r.end}: ${JSON.stringify(r.quote)}${r.class_evidence?`\n  Class wording · ${clock(r.class_evidence.start_ms)}–${clock(r.class_evidence.end_ms)} · unidentified speaker${r.class_evidence.uncertain?' · uncertain speech':''}: ${JSON.stringify(r.class_evidence.quote)}`:''}\n  Connection: ${r.explanation}${r.limitations.length?'\n  Reading limits: '+r.limitations.join(' '):''}`).join('\n'));
   if(topic.issues.length)parts.push('#### Check before relying on this topic\n\n'+topic.issues.map((s:string)=>'- '+s).join('\n'));
  }
  if(section.gaps.length)parts.push('#### Unresolved in this section\n\n'+section.gaps.map((s:string)=>'- '+s).join('\n'));
 }
 parts.push('## Active review\n\nTry each cue without reading the explanation, then compare with its exact class and course evidence. Add your response, teacher correction or unresolved question to this note.\n\n## Work and next class\n\nReview work mentioned in class in [Today](/beta?tab=today), then check the current Moodle instructions. Class-derived actions retain transcript evidence and need applicability/timing review; the absence of a task here does not mean no work was assigned.');
 return parts.join('\n\n');
}

export function cornellChapters(title:string,session:any,sections:any[],limitations:string[]){
 const chapters:{body:string;start:number;sections:number}[]=[],groups:{items:any[];start:number}[]=[];let items:any[]=[],start=0;
 for(const [index,section] of sections.entries()){
  const candidate=cornellBody(title,session,[...items,section],limitations,start);
  if(candidate.length>60000&&items.length){groups.push({items,start});items=[];start=index;}
  items.push(section);
 }
 if(items.length)groups.push({items,start});
 for(const group of groups){const body=cornellBody(title,session,group.items,limitations,group.start);if(body.length>80000)throw Error('One Cornell section exceeds the current Notebook size limit');chapters.push({body,start:group.start,sections:group.items.length});}
 return chapters;
}
