import {officeReadingLimits,type OfficeReading} from './office-reading';
import {savedMaterial} from './source-material';
import {classifyMoodleContent} from './moodle-content';
import {unverifiedForumSource,forumAuthorityNote} from './source-authority';
import {partialPdf,pdfReadingLimits,type PdfReading} from './pdf-reading';
import {sourceBlocks,sourceEvidenceBlocks} from './source-blocks';
import {gradedSections} from './exact-source-units';
import {latePolicyUnits} from './source-policy-units';
import {namedDates} from './dated-class-evidence';

type Quote={kind:'instruction'|'rubric'|'submission'|'definition';quote:string;start_line:number;end_line:number;unit:string|null};
export type GuideOmission={kind:Quote['kind']|'outline';reason:'passage_too_long'|'guide_limit';start_line:number;end_line:number;unit:string|null};
export type SourceContent={state:'no_text'|'partial'|'readable';reviewed:false;source_id:string;version_id:string;text_sha256:string;authority:'student_notes'|'ai_draft'|'observed_source';characters:number;lines:number;outline:{heading:string;start_line:number;unit:string|null}[];evidence:Quote[];omissions?:GuideOmission[];omission_count?:number;omissions_truncated?:boolean;limitations:string[]};
// A reproducible reading aid over the actual version, never a model summary
// promoted to instructor evidence. Quoted instructions retain their conditions.
export function sourceContent(row:{id:string;version_id:string;kind:string;title:string;body:string;original_url?:string;mime?:string;truncated?:boolean;pdf_reading?:PdfReading|null;office_reading?:OfficeReading|null;device_content?:{original_location:string}}):SourceContent{
 const body=row.body||'',material=savedMaterial({...row,body}),outline:SourceContent['outline']=[],evidence:Quote[]=[],omissions:GuideOmission[]=[];
 let omissionCount=0;
 const omit=(item:GuideOmission)=>{omissionCount++;if(omissions.length<24)omissions.push(item);};
 for(const block of sourceBlocks(body)){
  const line=block.text,unit=block.unit?.replace(/^Page (\d+) — local OCR supplement \(unreviewed\)$/,'Page $1 (OCR, unreviewed)').replace(/^Image (\d+) — local OCR supplement \(unreviewed\)$/,'Image $1 (photo OCR, unreviewed)')??null,location={start_line:block.start_line,end_line:block.end_line,unit};
  const headingLine=line.split(/\r?\n/)[0];
  if(block.heading&&(/^(?:#{1,4}\s+|(?:Page|Slide|Image) \d+)/i.test(headingLine)||/^(?:requirements?|instructions?|deliverables?|rubric|assessment criteria|submission|learning objectives?|class notes|definitions?)\s*:?$/i.test(headingLine))){
   if(outline.length>=24||headingLine.length>240)omit({...location,end_line:block.start_line,kind:'outline',reason:headingLine.length>240?'passage_too_long':'guide_limit'});
   else outline.push({heading:headingLine.replace(/^#+\s*/,''),start_line:block.start_line,unit});
  }
  let kind:Quote['kind']|null=null;
  if(/\b(?:rubric|assessment criteria|criteria for|marks? (?:for|allocated)|grading criteria)\b/i.test(line))kind='rubric';
  else if(/\b(?:submit|upload|hand in|turn in|file format|word count|AI (?:usage|use) (?:statement|overview|appendix))\b/i.test(line))kind='submission';
  else if(/\b(?:must|required to|need to|are expected to|include|complete|prepare|read before|deliverables?)\b/i.test(line))kind='instruction';
  else if(/\b(?:is defined as|means that|refers to|definition:)\b/i.test(line))kind='definition';
  if(kind&&!/^(?:#{1,4}\s*)?(?:rubric|assessment criteria|submission|instructions?|requirements?|deliverables?)\s*:?$/i.test(line)){
   if(line.length>1600||evidence.length>=24)omit({...location,kind,reason:line.length>1600?'passage_too_long':'guide_limit'});
   else evidence.push({...location,kind,quote:line});
  }
 }
 const status=classifyMoodleContent({title:row.title,url:row.original_url,body});
 const readable=status.text_state==='readable';
 return {state:!readable?'no_text':row.truncated||row.mime?.startsWith('image/')||!!row.office_reading?.images_total||partialPdf(row.pdf_reading)||Buffer.byteLength(body)>=(row.mime&&row.mime!=='text/plain'?512000:64000)?'partial':'readable',reviewed:false,source_id:row.id,version_id:row.version_id,text_sha256:material.text_sha256,authority:material.kind,characters:body.length,lines:body.split(/\r?\n/).length,outline,evidence,omissions,omission_count:omissionCount,omissions_truncated:omissionCount>omissions.length,
  limitations:[...(row.mime==='application/vnd.ms-powerpoint'?['Legacy PowerPoint text was recovered by local conversion. Open the preserved original to check layout, diagrams and visual emphasis.']:[]),...(row.device_content?['Device-extracted PDF content is a Companion observation, not independent verification of the original, page completeness, equations or layout.',...(row.device_content.original_location==='device_only'?['The original is reported as retained on the collecting Companion. This server has extracted text and a recovery reference, not the original bytes.']:[])]:[]),...(unverifiedForumSource(row)?[forumAuthorityNote]:[]),'This guide quotes saved text; review the full source and its context.','Missing quotations do not establish missing requirements.','Completion, submissions and grades are not verified by this guide.',...pdfReadingLimits(row.pdf_reading),...officeReadingLimits(row.office_reading),...(row.mime?.startsWith('image/')?['Photo text is a local OCR transcription of the preserved original image. Lines marked [unclear OCR] were uncertain, read differently by a checking pass, or touch the photo edge; compare them and any [unreadable line omitted] gaps with the photo.']:[]),...(row.mime&&row.mime!=='text/plain'?['Diagrams, layout and unreadable content may be missing from extracted text.']:[])]};
}

// Only explicit requests to understand instructions use this additional
// source-text view. Date/grade/policy questions retain ordinary retrieval.
export function instructionExcerpt(body:string,query:string,budget:number){
 if(!/\b(?:requirements?|instructions?|deliverables?|rubric|what (?:does|do).{0,40}(?:ask|require)|what (?:should|must) (?:i|we) (?:include|submit))\b/i.test(query)||/\b(?:when|date|grade|score|permission|allowed|policy)\b/i.test(query))return null;
 const profile=sourceContent({id:'',version_id:'',kind:'file',title:'',body});
 const focus=/\brubric\b/i.test(query)?'rubric':/\b(?:submit|submission)\b/i.test(query)?'submission':null;
 const quotes=profile.evidence.filter(item=>item.kind!=='definition').sort((a,b)=>Number(b.kind===focus)-Number(a.kind===focus)).map(item=>item.quote);
 if(!quotes.length)return null;
 const selected:string[]=[];let size=0;
 for(const quote of quotes){if(size+quote.length+(selected.length?2:0)>budget)continue;selected.push(quote);size+=quote.length+2;}
 return selected.length?selected.join('\n\n'):null;
}

// Keep a late-work rule and its adjacent exceptions together. A bag-of-words
// excerpt can otherwise cover "policy" in academic integrity and "submission"
// in file formatting, while cutting off the actual late-work conditions.
export function latePolicyExcerpt(body:string,query:string,budget:number){
 if(!/\b(?:late|overdue|extensions?)\b/i.test(query)||!/\b(?:submi\w*|assignments?|reports?|papers?|essays?|homework|work|policy|deadline)\b/i.test(query))return null;
 if(/\b(?:arrival|arriving|attendance|medieval)\b/i.test(query)&&!/\b(?:submi\w*|assignments?|reports?|papers?|essays?|homework)\b/i.test(query))return null;
 const blocks:string[]=[];
 for(const part of latePolicyUnits(body)){
  const block=part.text.trim();
  // Whole contiguous blocks only; an oversized rule must use ordinary bounded
  // search rather than presenting a truncated exception as the complete policy.
  if(block.length>budget||blocks.join('\n…\n').length+block.length+(blocks.length?3:0)>budget)return null;
  if(block)blocks.push(block);
 }
 return blocks.length?blocks.join('\n…\n'):null;
}

// Prefer an actual labelled AI-use passage to an opening synopsis that merely
// mentions the policy. Keep whole located units, including their exceptions;
// never turn this discovery view into permission or a complete-policy claim.
export function aiPolicyExcerpt(body:string,query:string,budget:number){
 if(!/\b(?:AI|artificial intelligence|Chat\s*GPT|Claude|generative)\b/i.test(query)||!/\b(?:allowed|permitted|permission|policy|policies|can (?:I|we)|may (?:I|we)|am I|are we)\b/i.test(query))return null;
 if(/\b(?:late|extensions?|office hours|due|deadline)\b/i.test(query))return null;
 const labelled=/\b(?:A Note Regarding\s+)?(?:Generative\s+AI|Artificial Intelligence|AI)\s+(?:Use(?:\s+Policy)?|Policy|assistants)\s*:?\s*(?=(?:In this course|You\s+(?:may|must|can|are)|Students|We|The use)\b)/i;
 // Discover the complete parent policy, including a restriction now exposed
 // as a child unit. Vault retrieval still expands/validates it against the
 // normal current units; this does not grant a coverage or reading bypass.
 const blocks=[...sourceEvidenceBlocks(body,{classroomRestrictions:false})].filter(block=>labelled.test(block.text)&&/\b(?:may|must|cannot|allowed|permitted|unauthorized|unless)\b/i.test(block.text));
 const unique=[...new Set(blocks.map(block=>block.text.trim()))];
 const whole=unique.join('\n…\n');return whole&&whole.length<=budget?whole:null;
}

// A request may contain "do not infer dates" or "quote every exception".
// Those words must not send retrieval to assignments instead of office hours.
// Keep the contiguous section, its paragraph markers and every condition.
export function officeHoursExcerpt(body:string,query:string,budget:number){
 if(!/\boffice[\s-]+hours?\b|\bconsultation[\s-]+hours?\b|\bhoras?\s+de\s+consulta\b/i.test(query))return null;
 const office=/\b(?:office[\s-]+hours?(?:\s*\/\s*consultations?)?|consultation[\s-]+hours?|horas?\s+de\s+consulta)(?:\s*:|(?=[ \t]*$))/i;
 const boundary=/\b(?:course\s+(?:overview|description|policies|structure|requirements)|required\s+materials|class\s+(?:time|location)|(?:section\s+[\w-]+\s+)?lab\s+time(?:slot)?|assessment|grading|learning outcomes)\b|\b(?:classroom|delivery|e-?mail|instructor|professor)\s*:/i;
 const lines=body.split(/\r?\n/),blocks:string[]=[];
 for(let i=0;i<lines.length;i++){
  const match=office.exec(lines[i]);if(!match)continue;
  const selected:string[]=[];
  // The saved office/room is useful for "when and where", without borrowing
  // the classroom or a room from a different instructor's section.
  for(let n=Math.max(0,i-7);n<i;n++)if(/^\s*Office(?:\s+Location)?\s*:/i.test(lines[n])&&lines[n].length<=240)selected.push(lines[n].trim());
  const prefix=lines[i].slice(0,match.index),rooms=[...prefix.matchAll(/\bOffice(?:\s+Location)?\s*:/gi)],room=rooms[rooms.length-1];
  if(room&&prefix.length-room.index!<=240)selected.push(prefix.slice(room.index).trim());
  let end=i;
  for(;end<Math.min(lines.length,i+48);end++){
   let line=end===i?lines[end].slice(match.index):lines[end];
   if(end>i&&office.test(line))break;
   const stop=boundary.exec(end===i?line.slice(match[0].length):line);
   if(stop){const offset=end===i?match[0].length:0;line=line.slice(0,offset+stop.index);if(line.trim())selected.push(line);break;}
   if(end>i&&/^\s*(?:#{1,4}\s+|[A-Z][A-Z /&-]{5,}:?\s*$)/.test(line)&&!/^\s*(?:[MTWFS]|T\/TH)\b/.test(line))break;
   selected.push(line);
  }
  const block=selected.join('\n').trim();
  // Never cut off an exception to make a section fit the prompt budget.
  if(block&&block.length<=budget&&blocks.join('\n…\n').length+block.length+(blocks.length?3:0)<=budget)blocks.push(block);
  i=Math.max(i,end-1);
 }
 // A later communication section can qualify virtual office hours. Keep its
 // whole available paragraph, including wrapped conditions, rather than only
 // the first labelled time block. This does not turn a standalone mention
 // into an instructor's identified office-hours section.
 if(!blocks.length)return null;
 const virtual=/\b(?:virtual|online|remote)\s+(?:office[\s-]+hours?|consultations?)\b|\boffice[\s-]+hours?\b.{0,100}\b(?:virtually|online|remotely|Teams|Zoom)\b/i;
 for(let i=0;i<lines.length;i++){
  if(!virtual.test(lines[i])||blocks.some(block=>block.includes(lines[i].trim())))continue;
  let begin=i;
  while(begin>0&&lines[begin-1].trim()&&!/^(?:Page|Slide|Paragraph) \d+\b/i.test(lines[begin-1])&&!boundary.test(lines[begin-1])&&!/^\s*[A-Z][A-Z /&-]{5,}:?\s*$/.test(lines[begin-1]))begin--;
  let end=i+1;
  while(end<lines.length&&lines[end].trim()&&!/^(?:Page|Slide|Paragraph) \d+\b/i.test(lines[end])&&!boundary.test(lines[end])&&!/^\s*[A-Z][A-Z /&-]{5,}:?\s*$/.test(lines[end]))end++;
  const paragraph=lines.slice(begin,end).join('\n');
  // A flattened PDF line may put the communication label after email prose.
  // Retain the labelled subsection; never borrow email response times.
  const at=virtual.exec(paragraph)!.index;
  const labels=[...paragraph.slice(0,at).matchAll(/\b[A-Z][A-Z /-]{1,30}:\s*/g)];
  const label=labels.at(-1),part=(label?paragraph.slice(label.index):paragraph).trim();
  if(!blocks.some(block=>block.includes(part)))blocks.push(part);
  i=end-1;
 }
 const whole=blocks.join('\n…\n');
 return whole.length<=budget?whole:null;
}

// A bibliography, assessment table or teaching-week group is one evidence
// unit. Word hits must not separate its title, date, weight and conditions.
// Return only exact substrings; no course facts are synthesized here.
export function courseInfoExcerpt(body:string,query:string,budget:number){
 const material=/\b(?:which|what)\b.{0,55}\b(?:book|textbook|text)\b.{0,35}\brequired\b|\brequired\s+(?:books?|textbooks?|texts?|readings?)\b/i.test(query)
  || /\b(?:which|what)\b.{0,90}\b(?:book|textbook)\b/i.test(query)&&!/\b(?:chapters?|pages?|arguments?|claims?|says?|means?)\b/i.test(query);
 const dates=namedDates(query);
 const guideLookup=/\bwhich\b.{0,70}\b(?:source|document|page)\b/i.test(query)&&/\b(?:weekly|readings?|weeks?)\b/i.test(query)&&/\b(?:evaluation|assessments?|grading)\b/i.test(query);
 const weekly=/\b(?:when|which weeks?|what weeks?)\b/i.test(query)&&/\b(?:cover|covered|covers|study|studied|discuss|read)\b/i.test(query)
  || dates.length>0&&/\bweeks?\b/i.test(query)&&/\b(?:classes|chapters?|readings?|discuss\w*|read|study|studied|cover\w*)\b/i.test(query);
 const assessment=/\b(?:when|dates?|times?|due|worth|weight|long|duration|second|after)\b/i.test(query)&&/\b(?:tests?|exams?|quizz?(?:es)?|assessments?|assignments?|forums?|introduction|reports?|projects?|reflections?|participation)\b/i.test(query)&&!/\b(?:AI|late|permission|allowed|absence|missed|miss|accommodation)\b/i.test(query);
 const clean=(value:string)=>value.toLowerCase().normalize('NFD').replace(/\p{M}/gu,'').replace(/[\u2010-\u2015_-]/g,' ').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 const stop=new Set('when which what weeks week does do did is are was were the a an in on of for to and or my our this that course cover covers covered study studied discuss discussed read reading readings book books textbook text texts required worth weight format how much long duration second major assessment after used using use assigned end title name'.split(' '));
 const topic=[...new Set(clean(query.replace(/\b[A-Z]{2,5}[ -]?\d{3,4}[A-Z]?\b/gi,' ')).split(' ').filter(t=>t.length>2&&!stop.has(t)))];
 const matches=(value:string)=>{const words=new Set(clean(value).split(' '));return topic.length>0&&topic.every(t=>words.has(t));};
 const join=(blocks:string[])=>{const out:string[]=[];for(const b of blocks){if(!b||out.includes(b)||out.some(x=>x.includes(b)))continue;if(out.join('\n…\n').length+b.length+(out.length?3:0)<=budget)out.push(b);}return out.length?out.join('\n…\n'):null;};
 if(material){
  const blocks:string[]=[];
  for(const m of body.matchAll(/\b(?:Texts|Required\s+(?:Books|Textbooks|Readings|Texts)|Course\s+Texts|Reading\s+List)\s*:/gi)){
   const tail=body.slice(m.index!+m[0].length),end=tail.search(/\b(?:Texts|Office Hours|Professor|Instructor)\s*:|\b(?:COURSE (?:DESCRIPTION|REQUIREMENTS|PROGRAM)|Mode of Evaluation|Week\s+(?:\d|One|Two|Three))\b/i);
   const block=body.slice(m.index!,end<0?body.length:m.index!+m[0].length+end).trim();
   if(block.length<=budget&&(!topic.length||matches(block)))blocks.push(block);
  }
  if(blocks.length)return join(blocks.sort((a,b)=>b.length-a.length));
 }
 if(guideLookup||weekly&&(topic.length||dates.length)){
  // A schedule heading carries its dates ("Week 7 (Oct. 19-23)", "Week 3: Sept 21").
  // Bare mentions such as "[Week 5]" or "Weeks Seven and Eight" are prose, and
  // the last of them would otherwise swallow everything up to the real schedule.
  const headings=[...body.matchAll(/\bWeek\s+(?:\d{1,2}|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Eleven|Twelve|Thirteen|Fourteen|Fifteen)\b(?=\s*(?:\(\s*(?:[A-Za-z]{3,10}\.?\s*\d|\d{1,2}\s*[\/.-]\s*\d)|[:\-\u2013\u2014]?\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d))(?:\s*\([^\n)]{1,65}\))?/gi)];
   const matchingDate=(heading:string)=>{
    const listed=namedDates(heading);
    return dates.some(target=>{
     if(target.year&&!new RegExp('\\b'+target.year+'\\b').test(body))return false;
     return listed.some(d=>{
      if(d.month!==target.month||d.year&&target.year&&d.year!==target.year)return false;
      const tail=heading.slice(d.end);
      const range=tail.match(/^\s*[-\u2013\u2014]\s*(\d{1,2})\b/);
      const listedDays=[...tail.matchAll(/,\s*(\d{1,2})\b/g)].map(match=>Number(match[1]));
      const end=range?Number(range[1]):d.day;
      return end<=31&&(target.day>=d.day&&target.day<=end||listedDays.includes(target.day));
     });
    });
   };
   const grouped=headings.map((m,i)=>({heading:m[0],text:body.slice(m.index!,headings[i+1]?.index??body.length).trim()}));
   if(guideLookup&&grouped.length){
    const label=/\b(?:Mode of Evaluation|Evaluation|Assessment Scheme)\s*:/i.exec(body);
    if(label){
     const tail=body.slice(label.index+label[0].length),end=tail.search(/\b(?:Texts|Office Hours|Professor|Instructor)\s*:|\bWeek\s+(?:\d|One|Two|Three)\b/i);
     const scheme=body.slice(label.index,end<0?body.length:label.index+label[0].length+end).trim();
     const parts=[scheme,grouped[0].text];
     if(parts.every(Boolean)&&parts.join('\n…\n').length<=budget)return join(parts);
    }
   }
   const blocks=grouped
    .filter(block=>dates.length?matchingDate(block.heading):matches(block.text)).map(block=>block.text);
  // Omitting a matching week would falsely shorten the teaching window.
  if(blocks.length&&blocks.join('\n…\n').length<=budget)return join(blocks);
 }
 if(assessment){
  // An ordered test list establishes "second" by its original order, not by
  // sorting dates from a nearby teaching calendar. Keep every appointment and
  // the following accommodation/format conditions as one labelled section.
  const schedule:string[]=[];
  const appointment=/\b(?:when|dates?|times?|schedule|long|duration)\b/i.test(query);
  for(const m of appointment?body.matchAll(/\b(?:Tests|Examinations|Quizzes|Assessment Schedule)\s*:/gi):[]){
   if(/^Tests/i.test(m[0])&&!/\btests?\b/i.test(query)||/^Examinations/i.test(m[0])&&!/\b(?:exams?|examinations?)\b/i.test(query)||/^Quizzes/i.test(m[0])&&!/\bquiz(?:zes)?\b/i.test(query))continue;
   const tail=body.slice(m.index!+m[0].length);
   const end=tail.search(/\b(?:Final\s+Exam(?:ination)?|Course\s+(?:learning\s+outcomes|description|requirements|structure|program)|Grading\s+(?:scheme|rubric)|Academic\s+integrity|Required\s+materials)\s*:/i);
   // A missing end boundary cannot establish that all conditions were kept.
   if(end<0)continue;
   const section=body.slice(m.index!,m.index!+m[0].length+end).trim();
   if(/\b(?:Date\s*\/\s*time|\d+[- ]minute|\d+\s*minutes)\b/i.test(section)&&/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d/i.test(section))schedule.push(section);
  }
  if(schedule.length){const complete=schedule.join('\n…\n');return complete.length<=budget?complete:null;}
  const blocks:string[]=[];
  for(const m of body.matchAll(/\b(?:COURSE REQUIREMENTS|MODE OF EVALUATION|ASSESSMENT SCHEDULE|ASSESSMENT WEIGHTS|GRADING\s+Deliverable)\b/g)){
   const tail=body.slice(m.index!+m[0].length),end=tail.search(/\b(?:For more information|Documents outlining|GRADING RUBRIC|ACADEMIC INTEGRITY|COURSE STRUCTURE|COURSE PROGRAM|GUIDELINES FOR)\b|\b[A-Z][a-z]+(?:[ -][A-Z][a-z]+){0,5}\s*:\s*\(\d+(?:\.\d+)?\s*%/);
   const block=body.slice(m.index!,end<0?body.length:m.index!+m[0].length+end).trim();
   if(block.length<=budget&&/\d\s*%/.test(block)&&/\b(?:test|quiz|assignment|assessment|introduction|report|project)\b/i.test(block))blocks.push(block);
  }
  if(blocks.length)return join(blocks);
 }
 return null;
}

// Keep the explicit reviewed appointment beside its citation. Nearby personal
// planning dates and a syllabus's earlier TBA are not substitutes for this line.
export function examReviewExcerpt(body:string,query:string,budget:number){
 if(!/\bfinal\s+exam(?:ination)?\b/i.test(query)||!/\b(?:when|date|time|room|scheduled)\b/i.test(query))return null;
 const lines=body.split(/\r?\n/).filter(line=>/^\s*(?:[-*]\s*)?Source review\s*:\s*Official\b[^\n]*\b(?:Registrar|examination schedule|exam(?:ination)? timetable)\b[^\n]*\bStart\s+20\d\d-\d\d-\d\d\s+[0-2]\d:[0-5]\d\b/i.test(line));
 const text=[...new Set(lines)].join('\n');
 return text&&text.length<=budget?text:null;
}

// A weight table cannot answer whether an action actually earns that grade.
// Prefer the complete labelled assessment section for a condition question.
// Never trim the last condition or synthesize a section from scattered hits.
export function assessmentDetailExcerpt(body:string,query:string,budget:number){
 if(!/\b(?:attendance|alone|counts?|qualif\w*|conditions?|requirements?)\b/i.test(query))return null;
 const stop=new Set('what which when how much does do is are the a an in on of for to and or my our this that class course worth weight attendance alone count counts qualify conditions condition requirements requirement'.split(' '));
 const wanted=new Set(query.toLowerCase().replace(/\b[a-z]{2,5}[ -]?\d{3,4}[a-z]?\b/g,' ').match(/[a-z]{3,}/g)?.filter(w=>!stop.has(w))||[]);
 if(!wanted.size)return null;
 const selected:string[]=[];
 for(const part of gradedSections(body)){
  if(!(part.heading.toLowerCase().match(/[a-z]{3,}/g)||[]).some(w=>wanted.has(w)))continue;
  const section=part.text.trim();
  if(!section||section.length>budget)return null;
  selected.push(section);
 }
 const whole=selected.join('\n…\n');
 return whole&&whole.length<=budget?whole:null;
}
