import type {MoodleCapture} from './companion';
import {CAMPUS_ZONE,addDays,weekday,zoneClock,zoneDate,zoneInstant} from './agenda';
// Synthetic reviewer data only. Every course, person, room, date and page here is invented for
// the Neyvu demo. Nothing is derived from a real university, Moodle site or student vault.
export const demoName='Demo reviewer';
export const demoEmail='reviewer@demo.schoolvault.invalid';
export const demoAccountLabel='Demo reviewer (synthetic data)';
export const demoIdentity='demo-student:1010 · Demo Student (synthetic)';
export const sampleDeviceLabel='Sample laptop (simulated)';
// RFC 2606 reserves .invalid: these links can never reach a real site.
export const demoOrigin='https://moodle.demo.invalid';
// Small vault: bounds what anyone holding the demo code can store per demo generation.
export const demoQuotaBytes=16*1024*1024,demoTextQuotaBytes=8*1024*1024;
export const demoSeedVersion=2;
const syntheticNotice='Synthetic demo page for Neyvu reviewers. It was not collected from a real Moodle site.';
const dayNames=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const monthNames=['January','February','March','April','May','June','July','August','September','October','November','December'];
// Deterministic (no locale data), so a re-collection of the same tenant produces identical pages.
function when(iso:string){
 const at=Date.parse(iso),date=zoneDate(at,CAMPUS_ZONE),[h,m]=zoneClock(at,CAMPUS_ZONE).split(':').map(Number),[,month,day]=date.split('-').map(Number);
 return `${dayNames[weekday(date)]}, ${monthNames[month-1]} ${day}, ${h%12||12}:${String(m).padStart(2,'0')} ${h<12?'AM':'PM'} (Halifax time)`;
}
export type DemoCourse={key:string;code:string;title:string;kind:'lecture'|'lab';moodle_id:string|null;url:string|null};
export type DemoCapture={key:string;course:string;capture:MoodleCapture};
export type DemoSeed={
 captured_at:string;courses:DemoCourse[];notes:{course:string;title:string;body:string}[];
 captures:DemoCapture[];laterCaptures:DemoCapture[];file:{key:string;course:string;name:string;mime:'text/plain';body:string};
 tasks:{source:string;external_id:string;evidence:{title:string;kind:string;due_at:string;authority:string;note:string}}[];
 meetings:{source:string;schedule:{title:string;kind:'class'|'lab';weekdays:number[];start_time:string;end_time:string;start_date:string;end_date:string;location:string}}[];
};
export function demoSeed(seedTime:Date):DemoSeed{
 const today=zoneDate(seedTime,CAMPUS_ZONE),at=(days:number,time:string)=>zoneInstant(addDays(today,days),time,CAMPUS_ZONE);
 const ps2=at(3,'23:59'),quiz=at(8,'18:00'),lab=at(5,'17:00'),captured_at=new Date(seedTime.getTime()-2*3600000).toISOString();
 const linear:DemoCourse={key:'linear',code:'DEMO 1010',title:'DEMO 1010 — Linear Algebra Sample',kind:'lecture',moodle_id:'1010',url:demoOrigin+'/course/view.php?id=1010'};
 const stats:DemoCourse={key:'stats',code:'DEMO 2020',title:'DEMO 2020 — Statistics Lab Sample',kind:'lab',moodle_id:null,url:null};
 const course={id:'1010',title:linear.title,url:linear.url!};
 const page=(key:string,title:string,path:string,body:string,issues:string[]):DemoCapture=>({key,course:'linear',capture:{course,identity:demoIdentity,title,url:demoOrigin+path,body,captured_at,coverage:{scope:path==='/course/view.php?id=1010'?'visible-course':'visible-activity',issues:[syntheticNotice,...issues]}}});
 const notCollected='PDFs, external videos, grades and deeper forum/book pages have not been collected by this capture.';
 return {
  captured_at,courses:[linear,stats],
  notes:[
   {course:'linear',title:'Week 3 lecture notes — Eigenvalues',body:`Sample class notes written for the Neyvu demo. Not from a real course.

Eigenvalues and eigenvectors (lecture, week 3)
- An eigenvector of a square matrix A is a nonzero vector v with A v = λ v. The number λ is its eigenvalue.
- Find eigenvalues from the characteristic polynomial: det(A − λI) = 0.
- Example: A = [[2, 1], [1, 2]] gives (2 − λ)² − 1 = 0, so λ = 3 or λ = 1.
  - λ = 3 has eigenvector (1, 1). λ = 1 has eigenvector (1, −1).
- The eigenspace for λ is the null space of A − λI.
- A is diagonalizable when it has n linearly independent eigenvectors: A = P D P⁻¹.

Question for office hours: why can a real matrix have complex eigenvalues?`},
   {course:'linear',title:'Study plan — Problem Set 2',body:`Personal study plan (sample). The official due date is on the sample course page.
- Today: reread the week 3 lecture notes on eigenvalues.
- Tomorrow: Problem Set 2, questions 1–3.
- Next day: questions 4–5, then check each answer against the notes.
- Before Quiz 1: review vectors, matrix multiplication and determinants.`},
   {course:'stats',title:'Lab 1 notes — Sampling distributions',body:`Sample lab notes written for the Neyvu demo.
- Population mean μ and sample mean x̄. The sample mean changes from sample to sample.
- Standard error of the mean: σ / √n. Quadrupling n halves the standard error.
- Central limit theorem: for large n, x̄ is approximately normal even when the population is skewed.
- Lab task: draw 200 samples of size n = 25 from a skewed population and plot the sample means.`},
  ],
  captures:[
   page('course-page','DEMO 1010 — Course page (sample capture)','/course/view.php?id=1010',`DEMO 1010 — Linear Algebra Sample
Sample course page for the Neyvu reviewer demo. Every name, date and room is fictional.

Announcements
- Welcome to the sample course. Lecture slides are posted after each class.
- Office hours: Thursdays 2:00–3:00 PM, Demo Hall 204.

Schedule
Lectures: Monday, Wednesday and Friday, 10:30–11:20 AM, Demo Hall 101.

Week 3 — Eigenvalues and eigenvectors
- Lecture notes: characteristic polynomial, eigenspaces, diagonalization.
- Problem Set 2 — Eigenvalues. Due ${when(ps2)}.
- Quiz 1 — Vectors and matrices (online). Closes ${when(quiz)}.

Week 4 — Orthogonality (section collapsed)`,['Some course sections are collapsed.',notCollected]),
   page('ps2-page','Problem Set 2 — Eigenvalues (sample assignment)','/mod/assign/view.php?id=91010',`Problem Set 2 — Eigenvalues
DEMO 1010 — Linear Algebra Sample. Fictional assignment for the Neyvu demo.

Due: ${when(ps2)}

1. Find the eigenvalues and eigenvectors of A = [[2, 1], [1, 2]].
2. Show that the 2×2 matrix for a 90° rotation has no real eigenvalues.
3. Diagonalize B = [[4, 1], [2, 3]] if possible.
4. Explain why similar matrices have the same characteristic polynomial.
5. True or false: every real symmetric matrix is diagonalizable. Justify your answer.

Submit one PDF. Sample late policy: 10% per day.
Submission status appears only on the course site. Neyvu does not collect it.`,['Submission status, grades and attached PDFs are not collected by this capture.']),
  ],
  laterCaptures:[
   page('week4-page','Week 4 reading — Orthogonality (sample capture)','/mod/page/view.php?id=91011',`Week 4 reading — Orthogonality
DEMO 1010 — Linear Algebra Sample. Fictional reading list for the Neyvu demo.
- Read the sample notes on inner products and orthogonal projections.
- Practice: project v = (3, 4) onto u = (1, 0).
- Preview for the next lecture: the Gram–Schmidt process.`,[]),
  ],
  file:{key:'lab-handout',course:'stats',name:'DEMO 2020 Lab 1 handout (sample).txt',mime:'text/plain',body:`DEMO 2020 — Statistics Lab Sample
Lab 1: Sampling distributions. Fictional handout for the Neyvu demo.

Lab sessions: Thursdays 2:30–5:20 PM, Demo Lab B.
Lab report 1 due: ${when(lab)}.

Goals
1. Simulate repeated sampling from a skewed population.
2. Compare the spread of sample means for n = 5, 25 and 100.
3. Relate what you see to the standard error σ / √n.

Report: two pages, one histogram per sample size, and a short paragraph on the central limit theorem.
`},
  tasks:[
   {source:'ps2-page',external_id:'demo-ps2',evidence:{title:'Problem Set 2 — Eigenvalues',kind:'assignment',due_at:ps2,authority:'Synthetic demo data',note:'Sample deadline for reviewers. Not from Moodle and not a submission record.'}},
   {source:'course-page',external_id:'demo-quiz1',evidence:{title:'Quiz 1 — Vectors and matrices',kind:'quiz',due_at:quiz,authority:'Synthetic demo data',note:'Sample deadline for reviewers. Not from Moodle and not a submission record.'}},
   {source:'lab-handout',external_id:'demo-lab1',evidence:{title:'Lab report 1 — Sampling distributions',kind:'assignment',due_at:lab,authority:'Synthetic demo data',note:'Sample deadline for reviewers. Not from Moodle and not a submission record.'}},
  ],
  meetings:[
   {source:'course-page',schedule:{title:'Lecture',kind:'class',weekdays:[1,3,5],start_time:'10:30',end_time:'11:20',start_date:addDays(today,-28),end_date:addDays(today,70),location:'Demo Hall 101 (fictional)'}},
   {source:'lab-handout',schedule:{title:'Lab',kind:'lab',weekdays:[4],start_time:'14:30',end_time:'17:20',start_date:addDays(today,-28),end_date:addDays(today,70),location:'Demo Lab B (fictional)'}},
  ],
 };
}
