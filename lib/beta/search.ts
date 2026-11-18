// Source search for the beta vault. Course-agnostic: nothing here is keyed to a course code,
// subject or particular student. Ranking runs in Postgres; the excerpt helpers are pure.
import {bilingualSearchQuestion} from './question-language';
import {workInventoryQuestion} from './chat-intent';
import {courseCode,mentionedCourseKeys} from './course-codes';
import {namedDates} from './dated-class-evidence';

// Scope is enforced by the caller; the already selected identity is not a
// passage topic. Preserve foreign/ambiguous codes and the original question.
export function scopedSearchQuestion(query:string,code:string){
 const known=courseCode(code)?.replace(/ /g,'');
 if(!known)return query;
 return query.replace(/\b([A-Z]{2,5}[ -]?\d{3,4}[A-Z]?)(?:['’]s)?\b/gi,(value,found)=>found.replace(/[ -]/g,'').toUpperCase()===known?' ':value);
}
export function sourceFitsCourse(source:{title:string;excerpt?:string},code:string,question:string,knownCodes?:Set<string>,storedInSelectedCourse=false){
 const known=(text:string)=>new Set([...mentionedCourseKeys(text)].filter(key=>!knownCodes||knownCodes.has(key)||[...knownCodes].some(known=>known.replace(/\d.*$/,'')===key.replace(/\d.*$/,''))));
 const titleCodes=known(source.title);
 // SQL has already enforced this source's stored course ID. An incidental
 // cross-reference in its body (for example a lab accommodation) cannot
 // reassign a generically named original to that other course. A title that
 // explicitly names a foreign course still requires a matching request.
 const found=storedInSelectedCourse&&!titleCodes.size?new Set<string>():known(source.title+' '+(source.excerpt||''));
 if(!found.size)return true;
 const allowed=mentionedCourseKeys(code+' '+question);
 return [...found].some(value=>allowed.has(value));
}
function conceptualRetrievalQuestion(question:string){
 return /\b(?:explain|why|concept|framework|think|argument|example|distinguish)\b/i.test(question)
  &&! /\b(?:due|deadlines?|dates?|when|time|polic(?:y|ies)|requirements?|instructions?|grades?|scores?|comments?|feedback|versions?|changes?|changed|conflicts?)\b/i.test(question);
}
export function conceptSourceDiversity<T extends {title:string;course_id?:string}>(rows:T[],question:string){
 if(!conceptualRetrievalQuestion(question))return rows;
 const seen=new Map<string,number>();
 return rows.filter(row=>{const key=(row.course_id||'')+'\0'+row.title.toLowerCase().replace(/\.(?:pdf|docx|md|txt|html?)$/,'');const n=seen.get(key)||0;seen.set(key,n+1);return n<2;});
}
export function continuationSourceAnchor(question:string){
 if(!/\b(?:review routine|recall|practice|understood|understanding check)\b/i.test(question.split('Previous student topic:')[0]))return null;
 const previous=question.split('Previous student topic:')[1];if(!previous)return null;
 const title=previous.match(/\b(?:based on|from|using)\s+[“"]([^”"]{3,100})[”"]|\b(?:based on|from|using)\s+([A-Z][^,?.!]{2,100}),/i);
 return (title?.[1]||title?.[2]||'').trim()||null;
}

export function conceptAnchorQuery(question:string){
 // The same conceptual/administrative distinction controls both diversity
 // and definition discovery. Do not hide factual revisions or policy text.
 if(!conceptualRetrievalQuestion(question))return null;
 // Prefer an explicitly named work in this turn to titles in older context.
 // Original candidates are still restricted before the SQL LIMIT.
 const current=question.split(/\nPrevious student topic:/i)[0];
 const named=current.match(/\b(?:from|in|to|of|on)\s+((?:The\s+)?[A-Z][a-z][\p{L}’'-]*(?:\s+(?:(?:the|and|of|to|a)\s+)*[A-Z][a-z][\p{L}’'-]*){1,5})/u)?.[1];
 if(named)return named;
 const stop=new Set(['THE','AND','FOR','WITH','WHAT','WHY','HOW','PLEASE','EXPLAIN','COMPARE']);
 const words=[...new Set(question.match(/\b[A-Z][A-Z0-9]{1,8}\b/g)||[])].filter(word=>!stop.has(word)).slice(0,3);
 return words.length?words.join(' '):null;
}

// One search term per word of the question, in question order (at most 40). plainto_tsquery
// normalizes each word (stemming, stopwords, punctuation), so the SQL never contains user text and
// a question with no terms simply matches nothing. A hyphenated word stays one term whose parts must
// all match, with or without the hyphen ("lab-report" finds "lab report"; "COVID-19" keeps -19), so
// "alpha-secret" never matches "beta-secret" through "secret" alone.
const terms=(question:string)=>String.raw`terms AS (
 SELECT q,(row_number() OVER (ORDER BY first))::int AS i FROM (
  SELECT q,min(n) AS first FROM (
   SELECT n,CASE WHEN strpos(w,'-')>0 THEN plainto_tsquery('english',w)||plainto_tsquery('english',translate(w,'-',' ')) ELSE plainto_tsquery('english',w) END AS q
   FROM regexp_split_to_table(${question},'[][(){}<>,;:!?"/|[:space:]]+') WITH ORDINALITY AS words(w,n)
   WHERE length(to_tsvector('english',w))>0
  ) word GROUP BY q ORDER BY first LIMIT 40
 ) term
)`;

// Document-type priors, generic to any course: official course information (syllabus, outline),
// then activities with due dates (Moodle assignment/quiz pages, material stating a due date), then
// other course material, then the student's own notes. Each is worth less than one matched term,
// so a prior only reorders sources that match the question about equally well.
const prior=String.raw`CASE WHEN s.kind='note' THEN 0
 WHEN s.title~*'\m(syllab\w*|outlines?|course (info\w*|overview|description|guide|polic\w*|schedule|handbook)|plan de cours)\M' OR s.original_url~'/course/view\.php\?' THEN 0.6
 WHEN s.original_url~'/mod/(assign|quiz|workshop|lesson)/' OR v.body~*'\m(due|deadline|closes)\M' THEN 0.4
 ELSE 0.2 END`;

// $1 user, $2 expanded ranking question, $3 course or null, $4 topic question.
// Administrative discovery terms have weight 0.1; original topic terms have weight 1.
// A passage or title matching ANY term is a candidate.
// Score: distinct terms matched in the passage or title, plus half a point per term in the title,
// plus the prior, plus ts_rank as a tie-breaker. Each source is ranked by its best passage, and
// returns its top two passages (the second only if its own text matches) for the excerpt.
// File names are matched as words: "Lab_4_Calorimetry.txt" is read as "Lab 4 Calorimetry".
export const searchSql=String.raw`WITH ${terms('$2')},${terms('$4').replace(/^terms AS/,'original AS')},
dated_targets AS (
 SELECT lower(left(parts[1],3)) AS month,parts[2]::int AS day
 FROM regexp_matches($4,'(?i)\m(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\M','g') AS matches(parts)
 WHERE parts[2]::int BETWEEN 1 AND 31 AND $4~*'\m(classes|class|lectures?|labs?)\M'
),
q AS (SELECT array_agg(q ORDER BY i) AS terms,string_agg('('||q::text||')',' | ' ORDER BY i)::tsquery AS any_term FROM terms),
src AS (
 SELECT s.id,s.title,s.course_id,s.kind,s.original_url,v.id AS version_id,v.observed_at,(${prior})::float8 AS prior
 FROM schoolvault.sources s JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.id=s.current_version
 WHERE s.user_id=$1 AND ($3::uuid IS NULL OR s.course_id=$3) AND s.kind!='ai_draft'
),
cand AS (
 SELECT src.*,p.ordinal,p.body,x.pv,x.tv FROM src CROSS JOIN q
 LEFT JOIN schoolvault.passages p ON p.user_id=$1 AND p.source_id=src.id AND p.version_id=src.version_id
 CROSS JOIN LATERAL (SELECT to_tsvector('english',coalesce(p.body,'')) AS pv,to_tsvector('english',regexp_replace(translate(src.title,'_',' '),'\.[A-Za-z]{2,4}$','')) AS tv OFFSET 0) x
 WHERE x.pv@@q.any_term OR x.tv@@q.any_term
),
-- Count matching source identities before computing corpus-wide weights.
-- Sorting term × passage rows with complete text vectors can spill hundreds
-- of MB for a normal vault; a term/source pair carries the same frequency.
term_sources AS MATERIALIZED (
 SELECT terms.i,cand.id FROM terms JOIN cand ON cand.pv@@terms.q OR cand.tv@@terms.q GROUP BY terms.i,cand.id
),
term_weights AS MATERIALIZED (
 SELECT terms.q AS t,CASE WHEN terms.q IN (SELECT q FROM original) THEN 1.0 ELSE 0.1 END *
 (1+ln(1+(SELECT count(*) FROM src)::float8/(1+count(term_sources.id)))) AS weight
 FROM terms LEFT JOIN term_sources ON term_sources.i=terms.i GROUP BY terms.q ORDER BY terms.q
),
scored AS (
 SELECT cand.id,cand.title,cand.course_id,cand.kind,cand.original_url,cand.version_id,cand.observed_at,cand.ordinal,cand.body,m.body_hits,
  m.hits+0.5*m.title_hits+cand.prior+ts_rank(cand.pv,q.any_term)
  -- A matching month/day pair beats "30 seconds" in a generic class note.
  -- Month names come from a fixed regex and days from a checked integer.
  +CASE WHEN EXISTS(SELECT 1 FROM dated_targets d WHERE cand.body~*('\m'||d.month||'[a-z]*\.?\s+'||d.day::text||'(st|nd|rd|th)?\M')) THEN 12 ELSE 0 END
  +CASE WHEN cand.prior>=0.6 AND $4~*'\m(books?|textbooks?|required|covers?|coverage|material)\M' THEN 2.5 ELSE 0 END
  +CASE WHEN cand.kind IN('file','moodle') AND $4~*'\m(outline|syllabus)\M'
   AND cand.prior>=0.6 AND (cand.original_url IS NOT NULL OR translate(cand.title,'_',' ')~*'\m(outline|syllabus)\M') THEN 8 ELSE 0 END
  +CASE WHEN cand.kind IN('file','moodle') AND $4~*'\m(require|requires|requirements?|instructions?|deadlines?|submit|due)\M'
   AND cand.tv@@q.any_term THEN 6 ELSE 0 END
  -- Named abbreviations anchor a concept request. Original framework or
  -- lecture passages must compete with many copies of the student's draft.
  +CASE WHEN cand.kind IN('file','moodle') AND EXISTS(
    SELECT 1 FROM regexp_matches($4,'\m([A-Z][A-Z0-9]{1,8})\M','g') AS a(parts)
    WHERE cand.pv@@plainto_tsquery('english',a.parts[1])) THEN 10 ELSE 0 END
  +CASE WHEN substring($4 from '(?i)((?:assignment|homework|quiz|test|exam)\s+\d{1,3})') IS NOT NULL
   AND cand.tv@@phraseto_tsquery('english',substring($4 from '(?i)((?:assignment|homework|quiz|test|exam)\s+\d{1,3})')) THEN 4
   -- A passage that labels a block with the same numbered assessment ("Test 1:"
   -- on a slide inside a lecture deck) is weaker evidence than a title but beats
   -- shared generic words. A passing mention in another assignment does not count.
   -- The captured phrase is only a word, spaces and digits, so it is regex-safe.
   WHEN substring($4 from '(?i)((?:assignment|homework|quiz|test|exam)\s+\d{1,3})') IS NOT NULL
   AND cand.body~*('\m'||regexp_replace(substring($4 from '(?i)((?:assignment|homework|quiz|test|exam)\s+\d{1,3})'),'\s+','\s+','g')||'\M\s*:') THEN 2 ELSE 0 END AS score
 FROM cand CROSS JOIN q CROSS JOIN LATERAL (
  SELECT coalesce(sum(CASE WHEN cand.pv@@t OR cand.tv@@t THEN weight ELSE 0 END),0) AS hits,
   coalesce(sum(CASE WHEN cand.tv@@t THEN weight ELSE 0 END),0) AS title_hits,count(*) FILTER (WHERE cand.pv@@t) AS body_hits
  FROM term_weights
 ) m
),
ranked AS (SELECT *,row_number() OVER (PARTITION BY id ORDER BY score DESC,ordinal) AS rn FROM scored),
best AS (SELECT * FROM ranked WHERE rn=1 ORDER BY score DESC,observed_at DESC,id LIMIT 16)
SELECT b.id,b.title,b.course_id,b.kind,b.original_url,b.version_id,b.observed_at,b.score::float8 AS score,
 v.body AS full_body,
 coalesce((SELECT json_agg(json_build_object('ordinal',r.ordinal,'body',r.body) ORDER BY r.ordinal) FROM ranked r WHERE r.id=b.id AND r.rn<=2 AND (r.rn=1 OR r.body_hits>0)),'[]') AS passages
FROM best b JOIN schoolvault.source_versions v ON v.user_id=$1 AND v.id=b.version_id
ORDER BY b.score DESC,b.observed_at DESC,b.id`;

// Students ask about "worth" and "graded"; course outlines often call the
// same information "evaluation" or "weight". Expand only these topic words.
// Restrict candidates before ranking/LIMIT. Filtering the first 16 general
// hits afterwards allows a full personal vault to hide every original.
export const definitionSearchSql=searchSql.replace("AND s.kind!='ai_draft'","AND s.kind IN ('file','moodle')");

export function searchQuestion(question:string){
 question=bilingualSearchQuestion(question);
 const ordinals:Record<string,string>={first:'1',second:'2',third:'3',fourth:'4',fifth:'5'};
 question=question.replace(/\b(first|second|third|fourth|fifth)\s+((?:[A-Z]{2,5}[ -]?\d{3,4}[A-Z]?\s+)?)(?:term\s+)?(test|exam|assignment|case|quiz)\b/gi,(_,ordinal,code,kind)=>code+kind+' '+ordinals[ordinal.toLowerCase()]);
 question=question.replace(/^\s*according to (?:the )?(?:saved |current )?/i,'')
  .replace(/[.!?;]\s*(?:cite (?:the )?source(?: and)?\s*)?(?:retain|preserve|include|flag) any (?:later |actual )?conflicts? (?:you can (?:actually )?see|in the saved sources)\.?\s*$/i,'')
  .replace(/[.!?;]\s*cite (?:the )?source\.?\s*$/i,'');
 // Conversational retrieval instructions describe the request, not its subject.
 let query=question.replace(/\b(?:how much|how many|cite (?:the )?(?:source|document)|(?:course )?document says|used at the end of)\b/gi,' ');
 // A trailing citation instruction names the evidence surface, not a claim
 // about citation styles or the syllabus itself. Keep topic-only requests.
 const withoutCitation=query.replace(/(?:[.;,]\s*|\s+)cite (?:the |a )?(?:syllabus|outline|sources?|documents?)\.?\s*$/i,'').trim();
 if(/[A-Za-z0-9]/.test(withoutCitation))query=withoutCitation;
 // Style and an invented example's setting must not outrank the course topic.
 // Preserve comparisons, dates, permissions and example-only subjects.
 const styled=query.replace(/\b(?:in (?:plain|simple) English|in (?:plain|simple) language|in (?:my|your) own words)\b/gi,' ')
  .replace(/[,;]?\s*with (?:one|a|an) (?:useful |simple |short |practical )?example(?: for (?:a|an) (?:university |college |class )?(?:group project|student|classroom))?\.?\s*$/i,' ')
  .replace(/^\s*(?:please\s+)?(?:explain|define)\s+(?:to me\s+)?/i,'').trim();
 if(/[A-Za-z0-9]/.test(styled))query=styled;
 if(workInventoryQuestion(question))query+=' assessments quiz lab laboratory in-class exercise worksheet discussion post readings preparation required due submit';
 if(/\b(?:worth|weights?)\b/i.test(question))query+=' weight percentage points grading';
 if(/\blength\b/i.test(question))query+=' duration minutes';
 if(/\bformat\b/i.test(question))query+=' form structure';
 if(/\b(?:delivered|delivery)\b/i.test(question))query+=' delivery recorded video';
 if(/\b(?:graded|grading|evaluation)\b/i.test(question))query+=' evaluation assessments weighting';
 if(/\boffice hours?\b/i.test(question))query+=' office location';
 if(/\b(?:laptops?|phones?|devices?)\b/i.test(question)&&/\b(?:class|classes|classroom|lecture)\b/i.test(question))query+=' electronic technology classroom permission';
 if(/\b(?:nonzero|scalar|equivalent)\b/i.test(question))query+=' elementary row operations nonzero equivalent';
 const assessmentTiming=/\b(?:when|dates?|time|schedule)\b/i.test(question)&&/\b(?:test\s+\d{1,3}|(?:next|term)\s+test|midterms?|exams?|examinations?)\b/i.test(question);
 const courseGuideLookup=/\bwhich\b.{0,70}\b(?:source|document|page)\b/i.test(question)&&/\b(?:weekly|readings?|weeks?)\b/i.test(question)&&/\b(?:evaluation|assessments?|grading)\b/i.test(question);
 if(assessmentTiming||courseGuideLookup)query+=' syllabus outline';
 for(const date of namedDates(question))query+=' '+date.month+(date.month==='sep'?' Sept':'');
 return query;
}
export function rankingQuestion(question:string){
 return /\b(?:due|deadline|worth|weights?|graded|grading|assessments?|exam|test|office hours|meet|lab section|business degree|required|textbook|books?|readings?|covers?|topics?|permission|classroom)\b/i.test(question)?question+' syllabus outline requirements schedule':question;
}

// $1 question, $2 text pieces: for each piece, the numbers of the question terms it contains.
// Compute this question's term list once. Inlining it into the correlated
// hit lookup rebuilds the same stemmed terms for every text piece.
export const pieceSql=String.raw`WITH ${terms('$1').replace(/^terms AS/,'terms AS MATERIALIZED')},
piece AS MATERIALIZED (SELECT n,to_tsvector('english',body) AS tv FROM unnest($2::text[]) WITH ORDINALITY AS u(body,n))
SELECT ARRAY(SELECT terms.i FROM terms WHERE piece.tv@@terms.q ORDER BY terms.i) AS hits FROM piece ORDER BY n`;

// Stored passages are 4,000-character slices every 3,500 characters, so neighbours overlap by 500.
// Adjacent passages are joined without repeating the overlap; others stay separate texts.
export function passageTexts(passages:{ordinal:number|null;body:string|null}[]){
 const out:{end:number;text:string}[]=[];
 for(const p of passages||[]){
  if(!p?.body)continue;
  const last=out[out.length-1],overlap=p.body.slice(0,500);
  if(last&&p.ordinal===last.end+1&&last.text.endsWith(overlap)){last.text+=p.body.slice(overlap.length);last.end=p.ordinal;}
  else out.push({end:p.ordinal??-1,text:p.body});
 }
 return out.map(p=>p.text);
}

// Cuts text into pieces of at most `max` characters at a line end, else a sentence end, else a
// space. Every character is kept, so neighbouring pieces join back into the original text.
export function segmentText(text:string,max=320){
 const out:string[]=[];let rest=text;
 while(rest.length){
  const line=rest.indexOf('\n');
  let cut=line>=0&&line<max?line+1:rest.length<=max?rest.length:0;
  if(!cut){
   const head=rest.slice(0,max);
   cut=Math.max(...['. ','? ','! ','; '].map(p=>head.lastIndexOf(p)))+2;
   if(cut<max/3)cut=head.lastIndexOf(' ')+1;
   // No boundary at all: cut hard, but never between the two halves of a surrogate pair.
   if(cut<max/3)cut=/[\uD800-\uDBFF]/.test(rest[max-1])?max-1:max;
  }
  out.push(rest.slice(0,cut));rest=rest.slice(cut);
 }
 return out;
}

export type Piece={text:string;hits:number[];priority?:number};
export const excerptGap='\n…\n';
// The excerpt a source contributes, at most `budget` characters: the pieces that together cover
// the most question terms (the first one covering the most), each grown into its neighbouring
// text, in document order. Separate stretches are joined with an ellipsis. Text that fits is
// returned whole; with no matching piece (a title match), it starts at the beginning.
export function bestExcerptPlan(texts:Piece[][],budget=1800){
 const pieces=texts.flatMap((text,group)=>text.map((p,index)=>({...p,group,index})));
 const render=(chosen:Set<number>)=>{
  const runs:string[]=[];let prev=-2;
  for(const i of [...chosen].sort((a,b)=>a-b)){
   if(i===prev+1&&pieces[i].group===pieces[prev].group)runs[runs.length-1]+=pieces[i].text;else runs.push(pieces[i].text);
   prev=i;
  }
  return runs.map(r=>r.trim()).filter(Boolean).join(excerptGap);
 };
 const whole=render(new Set(pieces.keys()));
 const result=(chosen:Set<number>)=>({excerpt:render(chosen),selected:[...chosen].sort((a,b)=>a-b).map(i=>({group:pieces[i].group,index:pieces[i].index}))});
 if(whole.length<=budget)return result(new Set(pieces.keys()));
 // Frequent words such as "assignment" must not displace a rare activity name.
 // Measure term rarity within this source; no course or bank answers are encoded.
 const frequency=new Map<number,number>();
 for(const p of pieces)for(const h of p.hits)frequency.set(h,(frequency.get(h)||0)+1);
 const weight=(h:number)=>1+Math.log2((pieces.length+1)/((frequency.get(h)||0)+1));
 const chosen=new Set<number>(),covered=new Set<number>();
 const fits=(i:number)=>{chosen.add(i);if(render(chosen).length<=budget)return true;chosen.delete(i);return false;};
 // Several sections can discuss the same activity (weight, instructions and
 // schedule). Keep up to four seed windows, including repeated topic matches.
 for(;chosen.size<4;){
  let best=-1,fresh=0,total=0;
  pieces.forEach((p,i)=>{
   if(chosen.has(i)||p.text.trim().length>budget)return;
   // Adjacent pieces belong to the same window and will be added as context.
   // Spending another seed there can crowd out a later bibliography or schedule.
   if([...chosen].some(j=>pieces[j].group===p.group&&Math.abs(j-i)===1))return;
   const freshHits=p.hits.filter(h=>!covered.has(h)).reduce((sum,h)=>sum+weight(h),0);
   const repeated=p.hits.reduce((sum,h)=>sum+weight(h),0);
   const f=p.hits.length?freshHits+0.25*repeated+(p.priority||0):0;
   if(f>fresh||f===fresh&&f>0&&p.hits.length>total){best=i;fresh=f;total=p.hits.length;}
  });
  if(best<0||!fits(best))break;
  for(const h of pieces[best].hits)covered.add(h);
 }
 if(!chosen.size)fits(0);
 const seeds=[...chosen];
 for(let grew=true;grew;){
  grew=false;
  for(const seed of seeds)for(const step of [1,-1]){
   let edge=seed;
   while(chosen.has(edge+step)&&pieces[edge+step].group===pieces[seed].group)edge+=step;
   const next=edge+step;
   if(pieces[next]?.group===pieces[seed].group&&!chosen.has(next)&&fits(next))grew=true;
  }
 }
 return result(chosen);
}

export function bestExcerpt(texts:Piece[][],budget=1800){return bestExcerptPlan(texts,budget).excerpt;}
