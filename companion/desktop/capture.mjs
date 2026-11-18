import {identityKey} from './protocol.mjs';
export const MOODLE='https://moodle.acadiau.ca';
export const MAX_ACTIVITY_PAGES=100,MAX_FORUM_DISCUSSIONS=40;
export const MAX_COURSE_LIST_PAGES=40;
export const MAX_REVIEW_COURSES=200;
export class MoodleIdentityError extends Error{}
export class MoodleSessionExpiredError extends MoodleIdentityError{}
export function readURL(value,courseOnly=false){
 try{
  const u=new URL(value),keys=[...u.searchParams.keys()],positive=key=>/^[1-9]\d{0,11}$/.test(u.searchParams.get(key)||'');
  if(u.origin!==MOODLE||u.username||u.password||u.hash||new Set(keys).size!==keys.length)return null;
  if(!courseOnly&&u.pathname==='/calendar/view.php'&&keys.length===2&&keys.includes('course')&&keys.includes('view')&&positive('course')&&u.searchParams.get('view')==='upcoming')return u.href;
  if(courseOnly)return u.pathname==='/course/view.php'&&keys.length===1&&keys[0]==='id'&&positive('id')?u.href:null;
  if(u.pathname==='/mod/book/view.php'&&keys.length===2&&keys.includes('id')&&keys.includes('chapterid'))return positive('id')&&positive('chapterid')?u.href:null;
  if(u.pathname==='/mod/forum/view.php'&&keys.length===2&&keys.includes('id')&&keys.includes('page'))return positive('id')&&/^(?:0|[1-9]\d{0,5})$/.test(u.searchParams.get('page')||'')?u.href:null;
  const discussion=u.pathname==='/mod/forum/discuss.php',key=discussion?'d':'id';
  return keys.length===1&&keys[0]===key&&positive(key)&&(discussion||u.pathname==='/course/view.php'||/^\/mod\/(assign|quiz|page|book|forum|folder|resource|url|lesson|workshop)\/view.php$/.test(u.pathname))?u.href:null;
 }catch{return null;}
}
// Discovery records every same-site file name even when no reader supports its format.
export function discoveredFileInventory(dom){
 const files=[];
 for(const item of [...(dom.attachment_links||[]),...(dom.embedded_content||[])]){
  try{const u=new URL(item.url),keys=[...u.searchParams.keys()];if(u.origin!==MOODLE||u.username||u.password||u.hash||!/^\/pluginfile\.php\/[1-9]\d{0,11}\/[a-z][a-z0-9_]*\/[a-z][a-z0-9_]*\/\d{1,12}\/.+/.test(u.pathname)||new Set(keys).size!==keys.length||keys.some(k=>!['forcedownload','time'].includes(k))||keys.some(k=>!/^\d{1,16}$/.test(u.searchParams.get(k)||'')))continue;const parts=u.pathname.split('/').slice(1).map(decodeURIComponent);if(parts.some(p=>!p||p==='.'||p==='..'||/[\/\\\x00-\x1f\x7f]/.test(p)))continue;u.search='';const title=String(item.title||parts.at(-1)).replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,180);if(title&&!files.some(f=>f.url===u.href))files.push({url:u.href,title});if(files.length>=200)break;}catch{}
 }
 return files;
}
// Read rendered course content only. This function contains no clicks, form posts or credentials.
export function pageDOM(){
 const main=document.querySelector('#region-main'),menu=document.querySelector('.usermenu')||document.querySelector('#user-menu-toggle')?.parentElement;
 const visible=node=>!!node?.getClientRects().length&&!node.closest('[hidden],[aria-hidden="true"]')&&getComputedStyle(node).visibility!=='hidden';
 // Moodle's activity description can be in the page header outside region-main.
 // Read only those standard description regions, not menus, forms or credentials.
 const descriptions=[...document.querySelectorAll('[data-for="page-activity-header"] .activity-description, .activity-header .activity-description')].filter(node=>visible(node)&&!main?.contains(node));
 const calendarCourse=location.pathname==='/calendar/view.php'?new URL(location.href).searchParams.get('course'):null;
 const calendarEvents=calendarCourse?[...main?.querySelectorAll('[data-type="event"][data-course-id]')||[]].filter(node=>visible(node)&&node.getAttribute('data-course-id')===calendarCourse):[];
 const regions=calendarCourse?calendarEvents:[...descriptions,...(main?[main]:[])],anchors=[...new Set(regions.flatMap(region=>[...region.querySelectorAll('a[href]')]).filter(visible))];
 const content=regions.map(region=>{const walker=document.createTreeWalker(region,NodeFilter.SHOW_TEXT),parts=[];for(let node=walker.nextNode();node;node=walker.nextNode()){const parent=node.parentElement;if(visible(parent)&&!parent.closest('a,button,input,select,textarea,script,style,nav,h1,h2,h3,h4,h5,h6,.pagination,.paging,.activity-navigation,.activitycompletion,[data-region="activity-information"]'))parts.push(node.textContent);}return parts.join(' ');}).join('\n').replace(/\s+/g,' ').trim();
 const frames=regions.flatMap(region=>[...region.querySelectorAll('iframe[src],object[data],embed[src]')]).filter(visible);
 const files=anchors.filter(a=>{try{const u=new URL(a.href);return u.pathname.startsWith('/pluginfile.php/')||/\.(?:pdf|txt|md|csv|png|jpe?g|webp|docx?|pptx?|xlsx?|zip)$/i.test(u.pathname);}catch{return false;}});
 const bookLinks=location.pathname==='/mod/book/view.php'?[...document.querySelectorAll('.block_book_toc a[href],#mod_book-chaptersnavigation a[href]')].filter(a=>visible(a)&&!a.closest('.dimmed_text')):[];
 const activityHeader=document.querySelector('[data-for="page-activity-header"],.activity-header'),activityHeading=activityHeader?.previousElementSibling;
 const activityTitle=activityHeading?.matches('h1,h2')?activityHeading.innerText:document.querySelector('h1')?.innerText;
 const profile=menu?.querySelector('#user-menu-toggle [title], .userbutton [title], .userpicture[title]'),label=menu?.querySelector('.usertext')?.innerText||profile?.title||menu?.querySelector('img[alt]')?.alt||'';
 const links=[...menu?.querySelectorAll('a[href]')||[],...document.querySelectorAll('#user-action-menu a[href]')];
 const profiles=links.filter(a=>{try{const u=new URL(a.href);return u.origin===location.origin&&/^\/user\/(profile|view)\.php$/.test(u.pathname);}catch{return false;}});
 const userLink=profiles.find(a=>/^[1-9]\d{0,11}$/.test(new URL(a.href).searchParams.get('id')||''))||profiles[0];
 const assessment=(()=>{
  const kind=location.pathname==='/mod/assign/view.php'?'assignment':location.pathname==='/mod/quiz/view.php'?'quiz':null;
  if(!kind)return undefined;
  const empty={kind,layout:'unavailable',rows:[],attempts:[],truncated:false};
  if(kind==='assignment'){
   // Moodle nests file-list layout tables inside this region. Only outer tables
   // establish receipts; rows inside attachments cannot supply or contradict status.
   const tables=[...main?.querySelectorAll('.submissionstatustable table')||[]].filter(table=>visible(table)&&!table.parentElement?.closest('.submissionstatustable table'));
   if(tables.length!==1)return empty;
   let incomplete=false;
   const rows=[...tables[0].querySelectorAll('tr')].filter(tr=>visible(tr)&&tr.closest('table')===tables[0]).flatMap(tr=>{const cells=[...tr.children].filter(n=>n.matches('th,td')&&visible(n)),label=cells[0]?.innerText.trim()||'';if(!/^(?:Submission status|Group|Members who need to submit|Members who have not submitted)$/i.test(label))return [];const value=cells[1]?.innerText.trim();if(cells.length!==2||!value){incomplete=true;return [];}return [{label,value:value.slice(0,1200),classes:[...cells[1].classList].slice(0,8)}];});
   if(incomplete)return empty;
   // Read grading separately from submission. Ignore upload tables and comments.
   // Missing/ambiguous grading must not erase an otherwise usable receipt.
   const outerRows=[...tables[0].querySelectorAll('tr')].filter(tr=>visible(tr)&&tr.closest('table')===tables[0]);
   const gradingRows=outerRows.flatMap(tr=>{const cells=[...tr.children].filter(n=>n.matches('th,td')&&visible(n)),label=cells[0]?.innerText.trim()||'';return cells.length===2&&/^(?:Attempt number|Grading status)$/i.test(label)?[{label,value:cells[1].innerText.trim(),classes:[...cells[1].classList].slice(0,8)}]:[];});
   const attemptRows=gradingRows.filter(r=>/^Attempt number$/i.test(r.label)),statusRows=gradingRows.filter(r=>/^Grading status$/i.test(r.label));
   let grading;
   if(attemptRows.length===1&&statusRows.length===1&&attemptRows[0].value&&statusRows[0].value){
    const feedback=[...main.querySelectorAll('.feedback table')].filter(table=>visible(table)&&!table.parentElement?.closest('.feedback table'));
    let incomplete=false;
    const released=feedback.length===1?[...feedback[0].querySelectorAll('tr')].filter(tr=>visible(tr)&&tr.closest('table')===feedback[0]).flatMap(tr=>{const cells=[...tr.children].filter(n=>n.matches('th,td')&&visible(n)),label=cells[0]?.innerText.trim()||'';if(!/^(?:Grade|Graded on)$/i.test(label))return [];const value=cells[1]?.innerText.trim()||'';if(cells.length!==2||!value)incomplete=true;return [{label,value:value.slice(0,240)}];}):[];
    grading={layout:feedback.length>1||incomplete?'unavailable':feedback.length===1?'assign-feedback-table':'assign-no-feedback',attempt:{label:attemptRows[0].label,value:attemptRows[0].value.slice(0,160)},status:{...statusRows[0],value:statusRows[0].value.slice(0,120)},rows:released.slice(0,4),truncated:attemptRows[0].value.length>160||statusRows[0].value.length>120||released.length>4||released.some(r=>r.value.length>=240)};
   }
   // Inspect controls only; never follow an edit or submission action.
   const controls=[...main.querySelectorAll('form button,form input[type="submit"],a[href]')].filter(n=>visible(n)&&!n.matches(':disabled')&&n.getAttribute('aria-disabled')!=='true').filter(n=>{
    const label=(n.innerText||n.value||'').trim();if(!/^(Add submission|Edit submission)$/i.test(label))return false;
    try{const form=n.closest('form'),u=new URL(form?.getAttribute('action')||n.getAttribute('href'),location.href),action=form?.querySelector('[name="action"]')?.value||u.searchParams.get('action'),id=form?.querySelector('[name="id"]')?.value||u.searchParams.get('id');return u.origin===location.origin&&u.pathname==='/mod/assign/view.php'&&id===new URL(location.href).searchParams.get('id')&&action==='editsubmission';}catch{return false;}
   });
   const closed=[...tables[0].querySelectorAll('tr')].filter(tr=>visible(tr)&&tr.closest('table')===tables[0]).flatMap(tr=>{const cells=[...tr.children].filter(n=>n.matches('th,td')&&visible(n));return cells.length===2&&/^Time remaining$/i.test(cells[0].innerText.trim())&&/^No more submissions are accepted\.?$/i.test(cells[1].innerText.trim())?[cells[1].innerText.trim()]:[];});
   const availability=controls.length&&!closed.length?{state:'open',label:(controls[0].innerText||controls[0].value).trim()}:closed.length===1&&!controls.length?{state:'closed',label:closed[0]}:null;
   const penalties=regions.flatMap(region=>region.innerText.split('\n').map(line=>line.trim()).filter(line=>/^Late submission penalty:\s+\S/i.test(line)&&line.length<=400));
   const cutoffLines=[...main.querySelectorAll('[data-region="activity-dates"],.activity-dates')].filter(visible).flatMap(region=>region.innerText.split('\n').map(line=>line.trim()).filter(line=>/^Cut-off date:\s+\S/i.test(line)&&line.length<=240));
   return {...empty,layout:'assign-status-table',rows:rows.slice(0,16),truncated:rows.length>16||rows.some(r=>r.value.length>=1200),...(grading?{grading}:{}),...(availability?{availability}:{}),...(penalties.length===1?{late_penalty:penalties[0]}:{}),...(cutoffLines.length===1?{cutoff:cutoffLines[0]}:{})};
  }
  const tables=[...main?.querySelectorAll('table.quizattemptsummary')||[]].filter(visible);
  const cards=[...main?.querySelectorAll('.card')||[]].filter(card=>visible(card)&&card.querySelector('table.quizreviewsummary')&&/^Attempt\b/i.test(card.querySelector('h4.card-title')?.innerText?.trim()||''));
  if(tables.length&&cards.length||tables.length>1)return empty;
  if(tables.length===1){
   const headers=[...tables[0].querySelectorAll('thead th')].map(n=>n.innerText.trim().toLowerCase()),number=headers.indexOf('attempt'),state=headers.indexOf('state');
   if(number<0||state<0||headers.filter(n=>n==='attempt').length!==1||headers.filter(n=>n==='state').length!==1)return empty;
   const attempts=[...tables[0].querySelectorAll('tbody tr')].filter(visible).map(tr=>{const cells=[...tr.children].filter(n=>n.matches('td,th')&&visible(n)),n=cells[number]?.innerText?.trim(),s=cells[state]?.innerText?.trim();return {number:n?.slice(0,40)||'',state:s?.slice(0,400)||''};});
   if(attempts.some(a=>!a.number||!a.state))return empty;
   return {...empty,layout:'quiz-attempt-table',attempts:attempts.slice(0,20),truncated:attempts.length>20||attempts.some(a=>a.state.length>=400||a.number.length>=40)};
  }
  if(cards.length){let incomplete=false;const attempts=cards.flatMap(card=>{const number=card.querySelector('h4.card-title').innerText.trim(),rows=[...card.querySelectorAll('table.quizreviewsummary tr')].filter(visible),status=rows.filter(tr=>tr.querySelector('th')?.innerText.trim()==='Status'),cell=status[0]?.querySelector('td'),state=visible(cell)?cell.innerText.trim():'';if(status.length!==1||!state){incomplete=true;return [];}return [{number:number.slice(0,40),state:state.slice(0,400)}];});if(incomplete)return empty;return {...empty,layout:'quiz-attempt-cards',attempts:attempts.slice(0,20),truncated:attempts.length>20||attempts.some(a=>a.state.length>=400||a.number.length>=40)};}
  return empty;
 })();
 const cfg=globalThis.M?.cfg;let trustedConfig=false;try{trustedConfig=new URL(cfg?.wwwroot).origin===location.origin;}catch{}
 const discussion=location.pathname==='/mod/forum/discuss.php';
 return {url:location.href,body_id:document.body.id,classes:document.body.className,title:(discussion?(main?.querySelector('.discussionname, .firstpost [data-region-content="forum-post-core-subject"], .firstpost .subject')?.innerText||document.title):location.pathname==='/mod/book/view.php'?(main?.querySelector('#mod_book-chapter h3, .book_content h3')?.innerText||document.title||activityTitle):activityTitle)||document.title,
  account_label:label||(document.body.id==='page-user-profile'?document.querySelector('h1')?.innerText:''),account_url:userLink?.href||'',runtime_user_id:trustedConfig?String(cfg.userId??''):'',profile_context_id:trustedConfig?String(cfg.contextInstanceId??''):'',
  calendar_links:[...document.querySelectorAll('a[href]')].filter(a=>visible(a)&&(()=>{try{const u=new URL(a.href);return u.origin===location.origin&&u.pathname==='/calendar/view.php';}catch{return false;}})()).map(a=>a.href).slice(0,20),calendar_course_id:calendarCourse,calendar_events:calendarEvents.length,
  assessment,text:regions.map(region=>region.innerText).filter(Boolean).join('\n'),content_text:content,links:[...new Set([...anchors,...bookLinks])].map(a=>({url:a.href,title:a.innerText,content_link:!a.closest('nav,.activity-navigation,.pagination,.paging,.activitycompletion'),collection_link:!a.closest('.activity-navigation,.activitycompletion')&&(!a.closest('nav')||!!a.closest('.pagination,.paging'))})),
  attachment_total:files.length,attachment_links:files.map(a=>({url:a.href,title:a.innerText})).slice(0,200),embedded_content:frames.map(node=>({url:node.src||node.data||'',kind:node.tagName.toLowerCase()})).slice(0,100),
  content_error:!!main?.querySelector('.errormessage,.errorbox,[data-region="error"]'),
  collapsed:main?.querySelectorAll('[data-for="section"] [data-for="sectiontoggler"][aria-expanded="false"], [data-for="section"] button[aria-expanded="false"]').length||0,
  forum_pagination:/^\/mod\/forum\/(view|discuss)\.php$/.test(location.pathname)&&!!main?.querySelector('.pagination a[href], .paging a[href]')};
}
export function captureContent(dom){
 const module=new URL(dom.url).pathname.match(/^\/mod\/([^/]+)\//)?.[1]||'course',readable=(dom.content_text??dom.text??'').trim();
 const titleOnly=!readable||readable===String(dom.title||'').trim(),files=Array.isArray(dom.attachment_links)?dom.attachment_links:[],embedded=Array.isArray(dom.embedded_content)?dom.embedded_content:[];
 const issues=[];
 if(dom.content_error)issues.push('Moodle displayed an error instead of readable activity content.');
 else if(titleOnly)issues.push('Only a title or links were visible; readable instructions were not found on this page.');
 // A link alone does not establish an import failure. The engine records
 // actual file-read failures and the server reports extraction readiness.
 if(embedded.length)issues.push('Embedded documents or media are present; their contents are not part of the rendered page text.');
 return {module,content_state:dom.content_error?'unreadable':!String(dom.text||'').trim()?'empty':titleOnly?'title-or-link-only':'rendered-text',readable_characters:titleOnly?0:readable.length,attachment_links:files.length,embedded_content:embedded.length,issues};
}
// Read only the standard course-overview controls; never follow arbitrary paging links.
// Selectors follow Moodle's block_myoverview and core/paged_content templates.
// Wait for Moodle's rendered overview, not its hidden initial links. A real
// empty-message is ready; placeholders, invisible links and an unfinished list
// are not. This read-only predicate is serialized into the owned browser.
export function courseListingReadyDOM(){
 const main=document.querySelector('#region-main'),overviews=[...main?.querySelectorAll('[data-region="myoverview"]')||[]];
 if(overviews.length>1)return true; // The checked reader reports ambiguity.
 const view=overviews[0]?.querySelector('[data-region="courses-view"]');
 const visible=e=>!!e?.getClientRects().length&&!e.closest('[hidden],[aria-hidden="true"]')&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
 const courseLink=a=>{try{const u=new URL(a.href);return visible(a)&&u.origin===location.origin&&u.pathname==='/course/view.php'&&/^[1-9]\d*$/.test(u.searchParams.get('id')||'');}catch{return false;}};
 return !![...(view||main)?.querySelectorAll('a[href]')||[]].some(courseLink)||!!view&&[...view.querySelectorAll('[data-region="empty-message"]')].some(visible);
}
export function courseListingDOM(){
 const main=document.querySelector('#region-main'),overviews=[...main?.querySelectorAll('[data-region="myoverview"]')||[]];
 const overview=overviews.length===1?overviews[0]:null,view=overview?.querySelector('[data-region="courses-view"]');
 const visible=e=>!!e?.getClientRects().length;
 const enabled=(control)=>{const items=[...overview?.querySelectorAll('[data-region="paging-bar"] [data-control="'+control+'"]')||[]].filter(visible);return items.length===1&&!items[0].classList.contains('disabled')&&items[0].getAttribute('aria-disabled')!=='true'&&items[0].querySelector('a')?.getAttribute('href')==='#';};
 const nextItems=[...overview?.querySelectorAll('[data-region="paging-bar"] [data-control="next"]')||[]].filter(e=>visible(e)&&!e.classList.contains('disabled')&&e.getAttribute('aria-disabled')!=='true');
 // Moodle's full accessible name is rendered HTML, while its title attribute
 // can contain another escaped layer. Read the exact accessible text first;
 // do not generically decode literal entities or combine it with shortened text.
 const title=a=>{const full=a.querySelector('.multiline .sr-only')?.textContent||a.querySelector('.multiline[title]')?.getAttribute('title');if(full?.trim())return full.trim().replace(/\s+/g,' ');const copy=a.cloneNode(true);for(const hidden of copy.querySelectorAll('.sr-only,.visually-hidden,[hidden]'))hidden.remove();return copy.textContent.trim().replace(/\s+/g,' ');};
 const named=[...view?.querySelectorAll('a.coursename[href]')||[]],others=[...view?.querySelectorAll('a[href]')||[]].filter(a=>!named.includes(a));

 return {standard:!!view,ambiguous:overviews.length>1,grouping:view?.getAttribute('data-grouping')||'',search:overview?.querySelector('input[data-region="input"]')?.value||overview?.querySelector('input[type="search"]')?.value||'',page:overview?.querySelector('[data-region="paging-bar"]')?.getAttribute('data-active-page-number')||'',links:[...named,...others].filter(visible).map(a=>{const card=a.closest('[data-region="course-content"][data-course-id]'),categories=[...card?.querySelectorAll('.categoryname')||[]].filter(visible);return {url:a.href,title:title(a),category:categories.length===1?categories[0].textContent.trim():'',card_id:card?.getAttribute('data-course-id')||''};}),first:enabled('first'),next:enabled('next'),unsupportedNext:nextItems.length>0&&!enabled('next'),otherPagination:!view&&!![...main?.querySelectorAll('.pagination, .paging')||[]].find(visible)};
}
// Follow one level of discussion links from a validated forum index only.
// Action, reply, grading, pagination and external URLs are never navigated.
export function forumDiscussionLinks(dom){
 if(dom.body_id!=='page-mod-forum-view'||!readURL(dom.url)||new URL(dom.url).pathname!=='/mod/forum/view.php')return [];
 return [...new Set(dom.links.map(link=>readURL(link.url)).filter(url=>url&&new URL(url).pathname==='/mod/forum/discuss.php'))];
}
// A shareable diagnostic contains structural flags only, never URLs, IDs, names,
// page text, session data or credentials.
export function identityDiagnostics(dom){
 let category='other';try{const u=new URL(dom.url);category=u.origin!==MOODLE?'outside':u.pathname.startsWith('/login/')?'login':u.pathname==='/user/profile.php'?'self-profile':u.pathname.startsWith('/my/')?'dashboard':readURL(u.href)?'course-page':'other';}catch{}
 return {category,signedOut:/\b(?:notloggedin|guestuser)\b/.test(dom.classes||''),labelPresent:!!dom.account_label?.trim(),profileLinkPresent:!!dom.account_url,runtimeIdPresent:/^[1-9]\d{0,11}$/.test(dom.runtime_user_id||''),profileContextPresent:/^[1-9]\d{0,11}$/.test(dom.profile_context_id||'')};
}
export function accountIdentity(dom){
 let page,profile;try{page=new URL(dom.url);if(dom.account_url)profile=new URL(dom.account_url);}catch{throw new MoodleIdentityError('Moodle account identity could not be checked.');}
 const signInMessage='Sign in to your own account in the Companion Moodle window, then choose Check Moodle account.';
 if(page.origin!==MOODLE||page.username||page.password)throw new MoodleIdentityError(signInMessage);
 if(page.pathname.startsWith('/login/')||/\b(?:notloggedin|guestuser)\b/.test(dom.classes||''))throw new MoodleSessionExpiredError(signInMessage);
 if(!dom.account_label?.trim()||/^guest(?: user)?$/i.test(dom.account_label.trim()))throw new MoodleIdentityError(signInMessage);
 if(profile&&(profile.origin!==MOODLE||profile.username||profile.password||profile.hash||!/^\/user\/(profile|view)\.php$/.test(profile.pathname)||profile.searchParams.getAll('id').length>1))throw new MoodleIdentityError('Moodle account identity could not be checked.');
 const linked=profile?.searchParams.get('id'),runtime=dom.runtime_user_id;
 if(linked&&!/^[1-9]\d{0,11}$/.test(linked)||runtime&&!/^[1-9]\d{0,11}$/.test(runtime)||linked&&runtime&&linked!==runtime)throw new MoodleIdentityError('Moodle account identifiers disagree. No material was uploaded.');
 const id=runtime||linked;
 if(!id)throw new MoodleIdentityError('Moodle did not expose a stable account ID in its menu. Open the profile menu in the Companion Moodle window, then choose Check Moodle account.');
 return 'moodle-user:'+id+' · '+dom.account_label.trim().slice(0,120);
}
// Only for a fresh navigation to the parameterless self-profile endpoint, never an arbitrary profile.
export function selfProfileIdentity(dom){
 const url=new URL(dom.url),id=dom.profile_context_id;
 if(url.origin!==MOODLE||url.username||url.password||url.pathname!=='/user/profile.php'||url.hash||[...url.searchParams.keys()].some(k=>k!=='id')||dom.body_id!=='page-user-profile'||!/^[1-9]\d{0,11}$/.test(id||'')||url.searchParams.has('id')&&url.searchParams.get('id')!==id)throw new MoodleIdentityError('Moodle could not confirm the current self-profile. No material was uploaded.');
 return accountIdentity({...dom,account_url:MOODLE+'/user/profile.php?id='+id});
}
export function makeCapture(dom,course,identity,now=new Date()){
 const url=readURL(dom.url);
 if(!dom.classes.split(/\s+/).includes('course-'+course.id)||identityKey(accountIdentity(dom))!==identityKey(identity))throw new MoodleIdentityError('Moodle page, account or course did not match. No material was uploaded.');
 if(!url||!dom.text.trim())throw Error('Unsupported Moodle page or empty content. No material was uploaded.');
 const isCourse=new URL(url).pathname==='/course/view.php',calendar=new URL(url).pathname==='/calendar/view.php';
 const discussion=new URL(url).pathname==='/mod/forum/discuss.php';
 if(calendar&&(new URL(url).searchParams.get('course')!==course.id||dom.body_id!=='page-calendar-view'||dom.calendar_course_id!==course.id||!Number.isSafeInteger(dom.calendar_events)||dom.calendar_events<1))throw Error('No readable course-matched Moodle Calendar events were found. This does not establish that the weekly timetable is empty.');
 if(isCourse&&(url!==course.url||!/^page-course-view-/.test(dom.body_id))||!isCourse&&!calendar&&(discussion?dom.body_id!=='page-mod-forum-discuss':dom.body_id!=='page-mod-'+new URL(url).pathname.split('/')[2]+'-view'))throw Error('Unsupported Moodle page layout. No material was uploaded.');
 if(dom.text.length>80000)throw Error('This page exceeds the capture limit. It needs a separate supported parser.');
  return {course,identity,title:dom.title.slice(0,180),url,body:dom.text,...(dom.assessment?{assessment:dom.assessment}:{}),captured_at:now.toISOString(),coverage:{scope:isCourse?'visible-course':'visible-activity',files:discoveredFileInventory(dom),files_truncated:dom.attachment_total>200,issues:[...(dom.attachment_total>200?['More than 200 file links were visible on this page; file discovery is incomplete.']:[]),...(dom.collapsed?['Some course sections are collapsed.']:[]),...(dom.forum_pagination&&dom.pagination_checked!==true?['Forum pagination is present; only pages reached within the bounded collection are checked.']:[]),...captureContent(dom).issues,...(dom.crawl_issues||[])].slice(0,30)}};
}

// Recognize Moodle's standard section disclosure only. Discovery is read-only;
// the engine validates identity/course before using these locally scoped IDs.
export function sectionDisclosures(){
 const main=document.querySelector('#region-main');
 return [...main?.querySelectorAll('[data-for="section"] [data-for="sectiontoggler"][aria-expanded="false"]')||[]].filter(node=>{
  const controls=node.getAttribute('aria-controls'),target=controls&&document.getElementById(controls),section=node.closest('[data-for="section"]');
  return /^collapsesectionid[1-9]\d{0,11}$/.test(node.id)&&/^coursecontentcollapseid[1-9]\d{0,11}$/.test(controls||'')&&section?.contains(target)&&node.getClientRects().length&&!node.closest('[hidden],[aria-hidden="true"]')&&getComputedStyle(node).visibility!=='hidden'&&
   (node.tagName==='BUTTON'||node.tagName==='A'&&node.getAttribute('role')==='button'&&node.getAttribute('href')==='#'+controls);
 }).slice(0,200).map(node=>node.id);
}

// Older servers reject unknown assessment fields. Negotiate this optional feature
// on every refresh, including coverage re-saves; never mutate retained capture data.
export function captureForService(capture,capabilities){
 if(!capture.assessment?.grading||capabilities?.assignment_grading===1)return capture;
 const {grading,...assessment}=capture.assessment;
 return {...capture,assessment,coverage:{...capture.coverage,issues:[...capture.coverage.issues,'This server does not yet accept assignment grading evidence; grades remain unverified.'].slice(0,30)}};
}
