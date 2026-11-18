import {createHash} from 'node:crypto';
import {sourceBlocks} from './source-blocks';
const stop=new Set('about after again also answer before could course draft explain from have help here just latest more notes please question saved should that their them there these this want what when where which will with would your continue resume revise review improve critique edit chosen earlier work my our the and con del para por que una unos las los este esta esto como quiero favor sigue continua continuar borrador revisa anterior elegido elegida'.split(' '));
const words=(text:string)=>text.toLocaleLowerCase('en').normalize('NFD').replace(/\p{M}/gu,'').match(/[\p{L}][\p{L}\p{N}-]{2,}/gu)||[];
export const contextTerms=(question:string)=>[...new Set(words(question).filter(w=>!stop.has(w)))].slice(0,30);
export function contextScore(text:string,terms:string[]){const set=new Set(words(text));return terms.reduce((sum,t)=>sum+(set.has(t)?1:0),0);}
export const continuingWork=(question:string)=>/\b(?:continue|resume|revise|revision|review|improve|critique|edit|my (?:draft|answer|argument)|what (?:we|i) (?:chose|decided)|pick up|working on|contin[uú]a(?:r)?|retoma(?:r)?|revisa(?:r)?|mejora(?:r)?|mi (?:borrador|respuesta|argumento)|decisi[oó]n anterior)\b/i.test(question);
export const personalGap='\n\n[… omitted personal text …]\n\n';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
// This is a snapshot of personal text, never source/author verification. Keep
// whole saved blocks; a large block is omitted rather than cut mid-condition.
export function continuityExcerpt(body:string,terms:string[],limit=2400){
 // A focused writing review carries one draft instead of two: allow its
 // existing total 4,800-character work budget without cropping a short memo.
 if(!Number.isSafeInteger(limit)||limit<0||limit>4800)throw Error('Invalid continuity budget');
 const blocks=[...sourceBlocks(body)],chosen=new Set<number>();let used=0;
 if(body.length>limit){
  const ranked=blocks.map((b,i)=>({i,score:contextScore(b.text,terms)})).sort((a,b)=>b.score-a.score||a.i-b.i);
  for(const {i} of ranked){const extra=blocks[i].text.length+(chosen.size?personalGap.length:0);if(used+extra<=limit){chosen.add(i);used+=extra;}}
 }else blocks.forEach((_,i)=>chosen.add(i));
 const selected=[...chosen].sort((a,b)=>a-b),text=body.length<=limit?body:selected.map(i=>blocks[i].text).join(personalGap);
 const omitted=blocks.filter((_,i)=>!chosen.has(i)),location=(b:(typeof blocks)[number])=>({start_line:b.start_line,end_line:b.end_line});
 return {text,truncated:body.length>limit,coverage:{format:'student-text-excerpt/1' as const,text_sha256:hash(body),excerpt_sha256:hash(text),saved_characters:body.length,complete:body.length<=limit,selected_units:selected.length,omitted_units:omitted.length,selected_locations:selected.map(i=>location(blocks[i])).slice(0,4),omitted_locations:omitted.map(location).slice(0,4),locations_truncated:selected.length>4||omitted.length>4}};
}
