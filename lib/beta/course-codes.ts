// Moodle cards often store the full title in the course's code field. Recognize
// a code only at the start; never turn a code mentioned inside a title into its
// identity, or choose between two different codes in one title.
const codePattern=/\b([A-Z]{2,5})[ -]?(\d{3,4}[A-Z]?)\b/gi;
const key=(value:string)=>value.replace(/[^A-Za-z0-9]/g,'').toUpperCase();
const dateToken=(prefix:string,number:string)=>/^(?:fall|term|year|march|april|may|june|july)$/i.test(prefix)&&/^20\d\d$/.test(number);
export function courseCode(value:string):string|null{
 // A captured Moodle accessibility label precedes the actual card title on
 // some pages. Remove only that literal label on its own line, not free prose.
 value=value.replace(/^\s*Course name[ \t]*\r?\n\s*/i,'');
 const leading=value.trim().match(/^([A-Z]{2,5})[ -]?(\d{3,4}[A-Z]?)(?=$|[\s:—–(\-])/i);
 if(!leading||dateToken(leading[1],leading[2]))return null;
 const canonical=(leading[1]+' '+leading[2]).toUpperCase();
 const found=mentionedCourseKeys(value);
 if(found.size!==1||!found.has(key(canonical)))return null;
 const rest=value.trim().slice(leading[0].length);
 if(/^\s*(?:\/|&|\+|and\b)\s*\d/i.test(rest)||/^\s*[-—–]\s*\d{3,4}\b/.test(rest))return null;
 return canonical;
}
export function mentionedCourseKeys(value:string){return new Set([...value.matchAll(codePattern)].filter(match=>!dateToken(match[1],match[2])).map(match=>key(match[1]+match[2])));}
export function uniqueCourseAliases<T extends {id:string;code:string}>(courses:T[]){
 const aliases=new Map<string,T|null>();
 for(const course of courses){const code=courseCode(course.code);if(!code)continue;const alias=key(code);aliases.set(alias,aliases.has(alias)?null:course);}
 return aliases;
}
export function workerCourse<T extends {code:string}>(course:T){return {...course,code:courseCode(course.code)||course.code};}
