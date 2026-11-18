export type CourseCapture={course_id:string;last_capture:string|null};
export type Freshness={state:'missing'|'unknown'|'fresh'|'stale';oldest:string|null;staleCourses:string[];missingCourses:string[]};
// A recently captured page cannot make another selected course current.
// These are page-capture ages, never a certificate of complete collection.
export function moodleFreshness(captures:CourseCapture[],now:Date,scope?:string[]):Freshness{
 const rows=scope?captures.filter(row=>scope.includes(row.course_id)):captures;
 if(!rows.length)return {state:'missing',oldest:null,staleCourses:[],missingCourses:scope||[]};
 const current=now.getTime(),missingCourses=[...new Set([...rows.filter(row=>!row.last_capture).map(row=>row.course_id),...(scope||[]).filter(id=>!rows.some(row=>row.course_id===id))])];
 const times=rows.filter(row=>row.last_capture).map(row=>({...row,time:Date.parse(row.last_capture!)}));
 if(!Number.isFinite(current)||times.some(row=>!Number.isFinite(row.time)||row.time>current+60000))return {state:'unknown',oldest:null,staleCourses:[],missingCourses};
 const staleCourses=times.filter(row=>current-row.time>2*60*60*1000).map(row=>row.course_id);
 const oldest=times.length?new Date(Math.min(...times.map(row=>row.time))).toISOString():null;
 return {state:!times.length?'missing':staleCourses.length||missingCourses.length?'stale':'fresh',oldest,staleCourses,missingCourses};
}
