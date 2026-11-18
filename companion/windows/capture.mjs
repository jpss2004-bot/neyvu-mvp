export const MOODLE='https://moodle.acadiau.ca';
export function readURL(value,courseOnly=false){
 try{const u=new URL(value),keys=[...u.searchParams.keys()];return u.origin===MOODLE&&!u.username&&!u.password&&!u.hash&&keys.length===1&&keys[0]==='id'&&/^\d{1,12}$/.test(u.searchParams.get('id')||'')&&(courseOnly?u.pathname==='/course/view.php':u.pathname==='/course/view.php'||/^\/mod\/(assign|quiz|page|book|forum|folder|resource|url|lesson|workshop)\/view.php$/.test(u.pathname))?u.href:null;}catch{return null;}
}
// Read rendered course content only. This function contains no clicks, form posts or credentials.
export function pageDOM(){
 const main=document.querySelector('#region-main'),profile=document.querySelector('#user-menu-toggle [title]'),userLink=[...document.querySelectorAll('.usermenu a[href],#user-action-menu a[href]')].find(a=>/\/user\/(profile|view)\.php\?/.test(a.href));
 return {url:location.href,body_id:document.body.id,classes:document.body.className,title:document.querySelector('h1')?.innerText||document.title,
  account_label:profile?.title||document.querySelector('.usermenu .usertext')?.innerText||'',account_url:userLink?.href||'',
  text:main?.innerText||'',links:[...main?.querySelectorAll('a[href]')||[]].map(a=>({url:a.href,title:a.innerText})),
  collapsed:main?.querySelectorAll('[data-for="section"] button[aria-expanded="false"]').length||0};
}
export function accountIdentity(dom){
 let u;try{u=new URL(dom.account_url);}catch{throw Error('Moodle did not expose a stable account identity. Open your user menu and try again.');}
 const id=u.searchParams.get('id');
 if(u.origin!==MOODLE||!/^\/user\/(profile|view)\.php$/.test(u.pathname)||!/^\d{1,12}$/.test(id||'')||!dom.account_label.trim())throw Error('Moodle account identity could not be checked.');
 return 'moodle-user:'+id+' · '+dom.account_label.trim().slice(0,120);
}
export function makeCapture(dom,course,identity,now=new Date()){
 const url=readURL(dom.url);if(!url||dom.classes.split(/\s+/).includes('notloggedin')||!dom.classes.split(/\s+/).includes('course-'+course.id)||accountIdentity(dom)!==identity||!dom.text.trim())throw Error('Moodle page, account or course did not match. No material was uploaded.');
 const isCourse=new URL(url).pathname==='/course/view.php';
 if(isCourse&&(url!==course.url||!/^page-course-view-/.test(dom.body_id))||!isCourse&&!/^page-mod-[a-z]+-view$/.test(dom.body_id))throw Error('Unsupported Moodle page layout. No material was uploaded.');
 if(dom.text.length>80000)throw Error('This page exceeds the capture limit. It needs a separate supported parser.');
 return {course,identity,title:dom.title.slice(0,180),url,body:dom.text,captured_at:now.toISOString(),coverage:{scope:isCourse?'visible-course':'visible-activity',issues:[...(dom.collapsed?['Some course sections are collapsed.']:[]),'PDFs, external videos, grades and deeper forum/book pages have not been collected by this capture.']}};
}
