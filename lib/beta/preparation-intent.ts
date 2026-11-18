export function preparationQuestion(question:string){return /\b(?:prepare me|help me prepare|class preparation|preparame|preparacion para clase)\b/i.test(question.normalize('NFKD').replace(/\p{M}/gu,''));}
// Retain the original question for generation and authority checks; use the
// student's subject words for retrieval instead of generic output instructions.
export function preparationTopic(question:string){
 if(!preparationQuestion(question))return question;
 const stop=new Set('prepare me to discuss for using the saved course readings explain actual main arguments examples distinctions tensions then give two discussion contributions use any notes if available identify specific missing sources without replacing preparation with collection counts cite passages and each assigned reading connect their ideas preserving section boundaries this my are contents or instead filling it general knowledge help class please important practical implications from what should i about of a an in on that how which'.split(' '));
 for(const word of 'contribute source overview begin start ready excerpt supporting supported include common misreadings adaptable talking points evidence follow followup questions subsection subsections clear clearly labeled label invented teaching written separately claims exactly parts'.split(' '))stop.add(word);
 const subjectWords=(text:string)=>text.replace(/\b[A-Z]{2,5}\s*\d{3,4}\b/g,'').split(/[^\p{L}\p{N}]+/u).filter(word=>word.length>2&&!/^\d+$/.test(word)&&!stop.has(word.toLowerCase()));
 // A substantive opening request carries the topic; later sentences usually
 // describe answer format. Keep decimal identifiers intact and fall back when
 // the opening is only "prepare me for class".
 const opening=subjectWords(question.split(/(?<!\d)[.!?](?!\d)\s/)[0]);
 const words=opening.length>=2?opening:subjectWords(question);
 const anchors=[...question.matchAll(/\b(?:chapters?|sections?|algorithms?|examples?|theorems?|lectures?|weeks?|slides?|pages?)\s+(?:\d+(?:\.\d+)*|[IVXLCDM]+)(?:\s*[-–]\s*(?:\d+(?:\.\d+)*|[IVXLCDM]+))?\b/gi)].map(m=>m[0]);
 const titles=[...question.matchAll(/["“]([^"”]{3,100})["”]/g)].map(m=>m[1]);
 const topic=[...new Set([...anchors,...titles,...words])].slice(0,16).join(' ');
 return topic?topic.replace(/\bteamwork\b/ig,'teamwork teams'):question;
}
