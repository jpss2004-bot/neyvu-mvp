export type Language='en'|'es';
export const languageCookie='neyvu-language';
export const languageTag:Record<Language,string>={en:'en-CA',es:'es-MX'};
export function supportedLanguage(value:unknown):Language|null{return value==='en'||value==='es'?value:null;}
export function preferredLanguage(accept:string|null|undefined):Language{
 const choices=(accept||'').split(',').map((entry,index)=>{const [tag,...params]=entry.trim().toLowerCase().split(';');const q=params.find(p=>p.trim().startsWith('q='));return {tag:tag.split('-')[0],weight:q?Number(q.trim().slice(2)):1,index};}).filter(v=>['en','es'].includes(v.tag)&&Number.isFinite(v.weight)&&v.weight>0&&v.weight<=1).sort((a,b)=>b.weight-a.weight||a.index-b.index);
 return supportedLanguage(choices[0]?.tag)||'en';
}
export function requestLanguage(input:{query?:unknown;cookie?:unknown;accept?:string|null}):Language{return supportedLanguage(input.query)||supportedLanguage(input.cookie)||preferredLanguage(input.accept);}
export function languageHref(href:string,language:Language){
 // Only internal destinations are language links; source URLs stay byte-for-byte intact.
 if(!href.startsWith('/')||href.startsWith('//')||href.startsWith('/api/'))return href;
 const url=new URL(href,'https://neyvu.invalid');url.searchParams.set('lang',language);return url.pathname+url.search+url.hash;
}
