/** Stable presentation only. Course colour never conveys status or applicability. */
export function courseTone(code:string):number {
 const key=code.toUpperCase().replace(/\s+/g,' ').trim();
 let hash=0;
 for(const char of key)hash=(Math.imul(hash,31)+char.charCodeAt(0))>>>0;
 return hash%7;
}
