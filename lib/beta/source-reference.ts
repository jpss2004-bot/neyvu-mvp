export function sourceReferenceHref(source:{id:string;version_id?:string|null}){
 return '#source-'+source.id+(source.version_id?':'+source.version_id:'');
}
export function findSourceReference<T extends {id:string;version_id?:string|null}>(sources:T[],href:string|undefined):T|undefined{
 const exact=sources.find(source=>!!source.version_id&&href===sourceReferenceHref(source));
 if(exact)return exact;
 // Older literal links may identify one source, but must never silently pick
 // a different version when the answer contains two versions of that source.
 const legacy=sources.filter(source=>href==='#source-'+source.id);
 return legacy.length===1?legacy[0]:undefined;
}
