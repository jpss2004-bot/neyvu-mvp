import {BetaHttpError} from './http';
import type {ReferenceMetadata,CitationStyle} from './research-types';
export function citationStyle(value:unknown):CitationStyle {if(value!=='apa'&&value!=='mla'&&value!=='chicago')throw new BetaHttpError('Choose a citation style.');return value;}
export function safeReferenceUrl(value:string){if(!value)return '';try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.hash||[...u.searchParams.keys()].some(k=>/token|key|auth|session|signature|code|credential/i.test(k)))return '';return u.href;}catch{return '';}}
export function referenceMetadata(raw:unknown):ReferenceMetadata{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new BetaHttpError('Invalid reference metadata.');
 const x=raw as Record<string,unknown>,out={} as ReferenceMetadata;
 for(const key of ['title','author','year','type','container','publisher','volume','issue','pages','doi','url'] as const){if(typeof x[key]!=='string'||x[key].length>(key==='url'?2000:500)||/[<>\u0000-\u0008]/.test(x[key]))throw new BetaHttpError('Invalid reference field: '+key);(out as unknown as Record<string,string>)[key]=x[key].trim();}
 if(!out.title)throw new BetaHttpError('Enter a source title.');
 if(!['document','article-journal','book','webpage','speech'].includes(out.type))throw new BetaHttpError('Choose a source type.');
 if(out.year&&!/^[12]\d{3}$/.test(out.year))throw new BetaHttpError('Enter a four-digit publication year or leave it blank.');
 if(out.doi&&!/^10\.\d{4,9}\/[^\s<>]+$/.test(out.doi))throw new BetaHttpError('Enter a DOI beginning with 10. or leave it blank.');
 if(out.url&&!safeReferenceUrl(out.url))throw new BetaHttpError('Use a public HTTPS source URL without credentials or access tokens.');
 return out;
}
export function initialReference(title:string,original?:string):ReferenceMetadata{return {title:title||'Untitled saved source',author:'',year:'',type:'document',container:'',publisher:'',volume:'',issue:'',pages:'',doi:'',url:safeReferenceUrl(original||'')};}
export function missingReferenceFields(m:ReferenceMetadata){const fields:string[]=[];if(!m.author)fields.push('author');if(!m.year)fields.push('publication year');if(m.type==='article-journal'&&!m.container)fields.push('journal');if(m.type==='book'&&!m.publisher)fields.push('publisher');return fields;}
// Only an explicit citation instruction is eligible, never a passing mention.
export function syllabusCitationStyle(body:string):{style:CitationStyle;quote:string}|null{
 const found:{style:CitationStyle;quote:string}[]=[];
 for(const sentence of body.split(/[\n.!?]+/).map(x=>x.trim()).filter(Boolean)){
  if(sentence.length>400||!/\b(?:must|require[ds]?|use|using|follow)\b/i.test(sentence)||!/\b(?:citat(?:ion|ions)|referenc(?:e|es|ing)|bibliograph\w*|style|format)\b/i.test(sentence)||/\b(?:not|optional|example|either|or)\b/i.test(sentence))continue;
  const styles: CitationStyle[]=[];if(/\bAPA(?:\s*(?:7(?:th)?|seventh))?\b/i.test(sentence))styles.push('apa');if(/\bMLA\b/i.test(sentence))styles.push('mla');if(/\bChicago\b.*\bauthor[ -]date\b/i.test(sentence))styles.push('chicago');
  if(styles.length===1&&!/\b(?:APA\s*6|MLA\s*8|footnotes?|notes and bibliography)\b/i.test(sentence))found.push({style:styles[0],quote:sentence});
 }
 return found.length&&new Set(found.map(x=>x.style)).size===1?found[0]:null;
}
