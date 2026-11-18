import {MOODLE,readURL,MoodleSessionExpiredError} from './capture.mjs';

// Installed before the first Moodle navigation. It is active only during a
// collection, leaving the student's ordinary signed-out sign-in flow usable.
const selfProfile=MOODLE+'/user/profile.php';
const courseList=MOODLE+'/my/courses.php';
const courseRead='core_course_get_enrolled_courses_by_timeline_classification';
// Moodle's course overview uses a POST even though this exact service only
// reads the signed-in user's enrolled courses. Never permit a mixed batch.
export function readOnlyMoodleAjax(request){
 try{
  const url=new URL(request.url()),keys=[...url.searchParams.keys()],body=request.postData();
  if(request.method()!=='POST'||url.origin!==MOODLE||url.username||url.password||url.hash||url.pathname!=='/lib/ajax/service.php'||new Set(keys).size!==keys.length||keys.some(key=>!['sesskey','info'].includes(key))||!url.searchParams.get('sesskey')||url.searchParams.get('info')?.split(',').some(name=>name!==courseRead)||typeof body!=='string'||body.length>65536)return false;
  const batch=JSON.parse(body);
  return Array.isArray(batch)&&batch.length>0&&batch.length<=5&&batch.every(item=>item&&Object.keys(item).every(key=>['index','methodname','args'].includes(key))&&item.methodname===courseRead&&item.args&&typeof item.args==='object'&&!Array.isArray(item.args));
 }catch{return false;}
}
export function collectionRequestGuard(active,onFailure=()=>{},ownCourseProfile=()=>false){
 return async(route,request)=>{
  if(!active())return route.continue();
  const url=request.url(),navigation=request.isNavigationRequest();
  const method=request.method();
  const ajax=readOnlyMoodleAjax(request);
  const parsed=new URL(url),action=parsed.origin===MOODLE&&['sesskey','action','attempt','submit','delete','confirm','reset'].some(key=>parsed.searchParams.has(key));
  if((!['GET','HEAD'].includes(method)||action)&&!ajax||navigation&&(!readURL(url)&&url!==selfProfile&&url!==courseList&&!ownCourseProfile(url))||/^https:\/\/moodle\.acadiau\.ca\/mod\/quiz\/(?:attempt|startattempt|processattempt|summary|review)\.php(?:[?#]|$)/.test(url)){
   onFailure(url,Error('Collection blocked an interactive or unsupported Moodle request. No quiz action was followed.'));
   return route.abort('blockedbyclient');
  }
  if(!navigation&&!ajax)return route.continue();
  let response;
  try{
   // route.continue can follow a redirect without another routing callback.
   // Fetch exactly one response and refuse the redirect before its target is
   // requested, including quiz attempts and login/SSO redirects.
   response=await route.fetch({maxRedirects:0,timeout:20000});
   if(response.status()>=300&&response.status()<400&&response.headers().location){
    let target;try{target=new URL(response.headers().location,url);}catch{}
    const error=target?.origin===MOODLE&&target.pathname.startsWith('/login/')?new MoodleSessionExpiredError('Moodle sign-in expired. Sign in in the Companion Moodle window, then check your account.'):Error('Moodle redirected this page; collection stopped before following its destination.');
    onFailure(url,error);return await route.abort('blockedbyclient');
   }
   return await route.fulfill({response});
  }catch(error){onFailure(url,error);return await route.abort('failed');}
  finally{await response?.dispose();}
 };
}
