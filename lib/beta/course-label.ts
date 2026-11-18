import {courseCode} from './course-codes';
// Presentation only: source/course identity and lecture/lab disambiguation use
// the unmodified stored values. Never rewrite the imported course record.
export function courseLabel(course:{code:string;title?:string}|undefined){
 if(!course)return 'Course';
 const captured=course.code.replace(/^\s*Course name[ \t]*\r?\n\s*/i,'').trim();
 // A Moodle card can repeat the whole title and include another course code
 // in a lab description. Its leading course and section are enough for a UI
 // label; retrieval aliases still use the untouched strict courseCode rules.
 const card=captured.match(/^([A-Z]{2,5}[ -]?\d{3,4}[A-Z]?)\s+((?:FA|WI|SP|SU)\d+(?:-\d+)?)\b/i);
 if(card&&courseCode(card[1]))return courseCode(card[1])+' · '+card[2].toUpperCase();
 return courseCode(course.code)||courseCode(course.title||'')||
  (course.title||course.code).replace(/^\s*Course name\s*\n\s*/i,'').trim().slice(0,120)||'Course';
}
