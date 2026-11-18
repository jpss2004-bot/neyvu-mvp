// Exact, explicitly delimited class-exception cells. Neither a week label nor
// a regular meeting pattern proves whether a dated class actually occurred.
const month=String.raw`Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?`;
const date=String.raw`\b(${month})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(20\d{2}))?\b`;
const qualify=/^\s*(?:however|unless|except|but|only|provided|subject to|this|these|those|it|they|(?:the\s+)?(?:labs?|lectures?))\b/i;
export function namedDates(text:string){
 return [...text.matchAll(new RegExp(date,'gi'))].filter(m=>Number(m[2])>=1&&Number(m[2])<=31).map(m=>({month:m[1].slice(0,3).toLowerCase(),day:Number(m[2]),year:m[3]||null,start:m.index!,end:m.index!+m[0].length}));
}
export function classExceptionUnits(body:string){
 const out:{start:number;end:number;text:string;month:string;day:number;year:string|null}[]=[];
 for(const d of namedDates(body)){
  const after=body.slice(d.end);
  if(!/^\s*[:—–-]?\s*(?:no\s+(?:(?:regular|scheduled)\s+)?(?:classes|lectures|labs)\b|(?:classes|lectures|labs)\s+(?:are\s+)?cancel(?:l)?ed\b)/i.test(after))continue;
  // A semicolon closes a table cell. Keep any subsequent qualifying cell;
  // physical line wraps and page markers alone never close a condition.
  let end=body.indexOf(';',d.end);if(end<0)continue;
  while(qualify.test(body.slice(end+1))){const next=body.indexOf(';',end+1);if(next<0){end=-1;break;}end=next;}
  if(end<0)continue;
  out.push({...d,start:d.start,end:end+1,text:body.slice(d.start,end+1)});
 }
 return out;
}
export function classExceptionExcerpt(body:string,question:string,budget:number){
 if(!/\b(?:class(?:es)?|lectures?|labs?)\b/i.test(question))return null;
 const dates=namedDates(question);if(dates.length!==1)return null;
 const target=dates[0];
 if(target.year&&!new RegExp('\\b'+target.year+'\\b').test(body))return null;
 const units=classExceptionUnits(body).filter(d=>d.month===target.month&&d.day===target.day&&(!target.year||!d.year||target.year===d.year));
 const text=units.map(d=>d.text).join('\n…\n');return text&&text.length<=budget?text:null;
}
