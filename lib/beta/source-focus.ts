export function moodleActivityLink(url:unknown){
 return typeof url==='string'&&/^https:\/\/moodle\.acadiau\.ca\/mod\/(?:assign|quiz)\/view\.php\?id=\d{1,12}$/.test(url)?url:undefined;
}

// A quote link may narrow its saved source excerpt, but only when the entire
// rendered quotation occurs there. Never focus a merely similar fragment.
export function quotedSourceExcerpt(excerpt:string|undefined,quotation:string|undefined){
 const quote=quotation?.replace(/\s*\[\d+\]\s*$/,'').trim();
 if(!excerpt||!quote||quote.length<48||quote.length>4000)return undefined;
 const normalize=(s:string)=>s.replace(/\s+/g,' ').trim();
 return normalize(excerpt).includes(normalize(quote))?quote:undefined;
}
export function locateSourcePassage(body:string,excerpt?:string){
 if(!excerpt?.trim())return null;
 const candidates=[excerpt,...excerpt.split(/\n\s*\n/)].map(s=>s.trim()).filter(s=>s.length>=48&&s.length<=4000);
 const offsets:number[]=[],chars:string[]=[];let space=false;
 for(let i=0;i<body.length;i++){if(/\s/.test(body[i])){if(!space){chars.push(' ');offsets.push(i);}space=true;}else{chars.push(body[i]);offsets.push(i);space=false;}}
 const normalized=chars.join('');for(const candidate of candidates){const exact=body.indexOf(candidate);if(exact>=0)return {start:exact,end:exact+candidate.length};const q=candidate.replace(/\s+/g,' '),at=normalized.indexOf(q);if(at>=0)return {start:offsets[at],end:offsets[at+q.length-1]+1};}
 return null;
}
