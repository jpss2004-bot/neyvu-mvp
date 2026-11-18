// Unlabelled times are accepted only in a short, identified syllabus header.
// A reading's examples and dated course-plan rows are not a weekly timetable.
export function syllabusHeaderTimes(body:string,title:string):{start:number;end:number}[]{
 if(!/syllabus|outline|course information/i.test(title))return [];
 const lines=body.split(/\r?\n/),out:{start:number;end:number}[]=[];
 const identity=lines.slice(0,40).findIndex(line=>/^\s*[A-Z]{2,5}\s*\d{4}[A-Z]?\b/i.test(line)&&!/^\s*(?:fall|term|year)\s*20\d{2}\b/i.test(line));
 if(identity<0)return [];
 for(let i=0;i<Math.min(lines.length,80);i++){
  const line=lines[i].trim();
  if(/local OCR.*unreviewed/i.test(line))break;
  if(/^(?:INSTRUCTOR BIO|COURSE DESCRIPTION|COURSE OVERVIEW|READINGS?|ASSESSMENTS?|GRADING|WEEK\s+\d)\b/i.test(line)||/^(?:Page|Slide)\s+[3-9]\b|^Paragraph\s+(?:1[3-9]|[2-9]\d)\b/i.test(line))break;
  if(i<=identity||!/^(?:MWF|MW|M\/W\/F|T\/TH|TU\/TH|TTh|TuTh)\s+\d{1,2}:\d{2}\s*[apm.]*\s*[−–—-]\s*\d{1,2}:\d{2}\s*[apm.]*\s*(?:,\s*[A-Z]{2,8}\s+\d{2,4}[A-Z]?)?$/i.test(line))continue;
  let end=i+1;
  // Word extraction places the room in its own numbered paragraph. Preserve
  // the exact intervening markers and lines, without taking the office room.
  for(let j=i+1;j<Math.min(lines.length,i+5);j++){
   if(!lines[j].trim()||/^Paragraph \d+$/i.test(lines[j].trim()))continue;
   if(/^[A-Z]{2,8}\s+\d{2,4}[A-Z]?$/.test(lines[j].trim()))end=j+1;
   break;
  }
  out.push({start:i,end});
 }
 return out;
}
export const codedLabRow=/^\s*([A-Z]{2,5})\s*(\d{3,4}L)\s+((?:FA|WI|SP|SU)\d+)\s*:\s*([MTWFS]|TH|TU)\s*,/i;
export function associatedLabRow(line:string,body:string){
 const match=line.match(codedLabRow);if(!match||line.length>300||/[\r\n]/.test(line)||!body.slice(0,6000).includes(line.trim()))return null;
 const code=(match[1]+' '+match[2]).toUpperCase();
 // An explicit lab section table is required; a course code alone isn't one.
 if(!/\blabs?\s*:/i.test(body.slice(0,6000))||!body.slice(0,6000).replace(/\s+/g,'').toUpperCase().includes('COURSECODE'+code.replace(' ','')))return null;
 return {code,section:match[3].toUpperCase(),day:({M:1,T:2,TU:2,W:3,TH:4,F:5,S:6} as Record<string,number>)[match[4].toUpperCase()]};
}
