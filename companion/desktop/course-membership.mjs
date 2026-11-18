import {MOODLE,accountIdentity,MoodleIdentityError} from './capture.mjs';
import {identityKey} from './protocol.mjs';

export function courseMembershipURL(courseId,identity){
 const id=identityKey(identity);
 if(!/^[1-9]\d{0,11}$/.test(courseId)||!/^[1-9]\d{0,11}$/.test(id))throw new MoodleIdentityError('A checked course and account are required for group detection.');
 return MOODLE+'/user/view.php?id='+id+'&course='+courseId;
}
// Moodle 4.5 core_myprofile_navigation renders the course's own groups in a
// profile_tree contentnode dl. Read only that field, never a participant list,
// selected group filter, arbitrary biography, or any editable form.
export function courseMembershipDOM(){
 const visible=e=>!!e?.getClientRects().length&&!e.closest('[hidden],[aria-hidden="true"]')&&getComputedStyle(e).visibility!=='hidden';
 const rows=[...document.querySelectorAll('#region-main .profile_tree .contentnode > dl')].filter(visible).filter(dl=>/^(?:Group|Groups)$/i.test(dl.querySelector(':scope > dt')?.innerText.trim()||''));
 const row=rows.length===1?rows[0]:null,dd=row?.querySelector(':scope > dd'),links=[...dd?.querySelectorAll('a[href]')||[]].filter(visible);
 return {url:location.href,profile_course:new URL(location.href).searchParams.get('course'),path_user:document.body.classList.contains('path-user'),row_count:rows.length,label:row?.querySelector(':scope > dt')?.innerText.trim()||'',value:dd?.innerText.trim()||'',links:links.slice(0,41).map(a=>({url:a.href,name:a.innerText.trim()})),truncated:links.length>40};
}
export function makeCourseMembership(dom,before,after,course,identity,now=new Date()){
 const url=courseMembershipURL(course.id,identity),id=identityKey(identity);
 const unknown=()=>({format:'moodle-own-course-groups/1',identity_key:id,course_id:course.id,profile_url:url,state:'unknown',groups:[],captured_at:now.toISOString()});
 for(const account of [before,after])if(account.url!==url||identityKey(accountIdentity(account))!==id||account.runtime_user_id&&account.runtime_user_id!==id||account.profile_context_id&&account.profile_context_id!==course.id)throw new MoodleIdentityError('The account or course changed during group detection. No group was saved.');
 if(dom.url!==url||dom.profile_course!==course.id)throw new MoodleIdentityError('Moodle did not return your own course profile.');
 // Missing theme/config evidence is uncertainty, not a false sign-in failure.
 if(!dom.path_user||[before,after].some(account=>!account.runtime_user_id||!account.profile_context_id))return unknown();
 let state=dom.row_count>1?'conflict':'unknown';const groups=[];
 if(dom.row_count===1&&!dom.truncated&&dom.links.length&&dom.links.length<=40){
  state='observed';
  for(const link of dom.links){
   let u;try{u=new URL(link.url);}catch{state='unknown';break;}
   const keys=[...u.searchParams.keys()],name=String(link.name||'').trim(),group=u.searchParams.get('group');
   if(u.origin!==MOODLE||u.username||u.password||u.hash||u.pathname!=='/user/index.php'||keys.length!==2||new Set(keys).size!==2||!keys.includes('id')||!keys.includes('group')||u.searchParams.get('id')!==course.id||!/^[1-9]\d{0,11}$/.test(group||'')||!name||name.length>180||/[\x00-\x1f\x7f]/.test(name)||/^(?:all groups|all participants|none|select|choose)\b/i.test(name)){state='unknown';break;}
   if(groups.some(g=>g.id===group)){state='conflict';break;}
   groups.push({id:group,name});
  }
  // Reject unexplained text and unlinked groups, including hidden partial lists.
  const text=s=>s.replace(/\s+/g,' ').trim();
  if(state==='observed'&&text(dom.value)!==text(groups.map(g=>g.name).join(', ')))state='unknown';
 }
 return {format:'moodle-own-course-groups/1',identity_key:id,course_id:course.id,profile_url:url,state,groups:state==='observed'?groups:[],captured_at:now.toISOString()};
}
