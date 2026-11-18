import {es} from './i18n/es';
import type {Language} from './language';
export type MessageValues=Record<string,string|number>;
// Old UI state stores formatted English feedback. Recognize only catalogue
// templates with substantial fixed wording, preserving captured values literally.
// This is deliberately scoped to UI messages; source text never uses translate.
const templates=Object.entries(es).filter(([key])=>/\{\w+\}/.test(key)&&key.replace(/\{\w+\}/g,'').length>=12).map(([key,copy])=>{
 const names:string[]=[];let pattern='',start=0;
 for(const match of key.matchAll(/\{(\w+)\}/g)){pattern+=key.slice(start,match.index).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'([\\s\\S]*?)';names.push(match[1]);start=match.index!+match[0].length;}
 pattern+=key.slice(start).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 return {pattern:new RegExp('^'+pattern+'$'),names,copy};
});

export function translate(language:Language,message:string,values:MessageValues={}):string{
 const key=message.replace(/\s+/g,' ').trim();
 let copy=language==='es'?(Object.hasOwn(es,key)?es[key]:message):message;
 // Saved progress messages contain numeric values. Match only known numeric
 // templates; student notes, quotations and generated answers never use this API.
 if(language==='es'&&!Object.hasOwn(es,key)){
  if(key.length<=4000)for(const template of templates){const match=key.match(template.pattern);if(match){const captured=Object.create(null) as Record<string,string>;template.names.forEach((name,i)=>captured[name]=match[i+1]);copy=template.copy.replace(/\{(\w+)\}/g,(value,name)=>Object.hasOwn(captured,name)?captured[name]:value);break;}}

  const age=key.match(/^(\d+)(s ago| min ago| hr ago| day ago| days ago)$/);
  if(age)copy=(es['{count}'+age[2]]??message).replace('{count}',age[1]);
  const noText=key.match(/^No selectable text was recovered from PDF pages? ([\d, ]+)\. These pages may be blank, scanned or contain diagrams; check the original or use OCR\.$/);
  const partial=key.match(/^Only (\d+) of (\d+) PDF pages were processed\. Later pages are not available in the saved text\.$/);
  const ocr=key.match(/^Local OCR recovered text from PDF pages ([\d, ]+)\. This text is unreviewed; compare the original before relying on equations or layout\.$/);
  const visual=key.match(/^PDF pages ([\d, ]+): visual content needs review alongside the text\. OCR does not interpret diagrams\.$/);
  if(noText)copy=translate(language,'No selectable text on PDF pages {pages}. Check the original or use OCR.',{pages:noText[1]});
  else if(partial)copy=translate(language,'Only {read} of {total} PDF pages were processed. Later pages are unavailable.',{read:partial[1],total:partial[2]});
  else if(ocr)copy=translate(language,'OCR text on PDF pages {pages} is unreviewed. Check equations and layout in the original.',{pages:ocr[1]});
  else if(visual)copy=translate(language,'PDF pages {pages}: review visual content in the original. OCR does not interpret diagrams.',{pages:visual[1]});
 }
 return copy.replace(/\{(\w+)\}/g,(match,name)=>Object.hasOwn(values,name)?String(values[name]):match);
}
export function translator(language:Language){return (message:string,values?:MessageValues)=>translate(language,message,values);}
