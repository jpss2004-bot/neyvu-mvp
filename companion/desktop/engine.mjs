import {courseMembershipURL,courseMembershipDOM,makeCourseMembership} from './course-membership.mjs';
import {chromium} from 'playwright-core';
import {join} from 'node:path';
import {MOODLE,readURL,pageDOM,sectionDisclosures,courseListingDOM,courseListingReadyDOM,accountIdentity,selfProfileIdentity,captureForService,makeCapture,identityDiagnostics,forumDiscussionLinks,MAX_ACTIVITY_PAGES,MAX_FORUM_DISCUSSIONS,MAX_COURSE_LIST_PAGES,MAX_REVIEW_COURSES,MoodleIdentityError,MoodleSessionExpiredError} from './capture.mjs';
import {collectionStart,collectionFollowups} from './collection-plan.mjs';
import {attachmentCandidates,readAttachment,MAX_ATTACHMENT_RUN_BYTES,MAX_ATTACHMENTS_PER_COURSE,MAX_ATTACHMENTS_PER_RUN} from './attachment-read.mjs';
import {collectionMemory,originalKey,chooseOriginal,markOriginal,markNestedPage,collectionIssue,collectionCycle,MAX_COLLECTION_PASSES} from './collection-memory.mjs';
import {identityKey,RELEASE} from './protocol.mjs';
import {ORIGIN} from './handoff.mjs';
import {serviceCheck,moodleBrowser} from './preflight.mjs';
import {collectionRequestGuard} from './collection-navigation.mjs';
const browserNetworkInterrupted=error=>/\bnet::ERR_(?:NETWORK_IO_SUSPENDED|NETWORK_CHANGED|INTERNET_DISCONNECTED|CONNECTION_RESET|CONNECTION_CLOSED|CONNECTION_ABORTED|CONNECTION_TIMED_OUT|TIMED_OUT|NAME_NOT_RESOLVED)\b/.test(String(error?.message||''));
const courseWideFailure=error=>!!error?.cancelled||error instanceof MoodleIdentityError||[401,409].includes(error?.status)||error?.status>=500||error?.retryable===true||error?.name==='TimeoutError'||browserNetworkInterrupted(error)||/net::ERR_|timed out|timeout|HTTP 5\d\d|Target.*closed|browser.*closed/i.test(String(error?.message||''));
export class Companion {
 constructor({root,load,save,emit,clearProfile=async()=>{},checkEdge,checkBrowser=moodleBrowser,checkService=serviceCheck,deviceContent=null}){Object.assign(this,{root,load,save,emit,clearProfile,deviceContent,checkBrowser:checkEdge?async()=>await checkEdge()?{name:'Microsoft Edge'}:null:checkBrowser,checkService});this.web=ORIGIN;this.status={stage:'welcome',title:'Your courses, connected.',detail:'Connect your Neyvu account, then sign in to Acadia Moodle.'};this.busy=false;}
 update(value){this.status={...this.status,...value};this.emit(this.status);}
 checkStatus(name,state,detail){this.update({checks:(this.status.checks||[]).map(c=>c.name===name?{name,state,detail}:c)});}
 async request(path,body,secret){let r;try{r=await fetch(ORIGIN+path,{method:'POST',headers:{'Content-Type':'application/json',...(secret?{Authorization:'Bearer '+secret}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(30000),redirect:'error'});}catch(e){if(['TimeoutError','AbortError','TypeError'].includes(e.name))e.retryable=true;throw e;}const data=await r.json().catch(()=>null);if(!r.ok){const e=Error(data?.error||'Neyvu could not receive this update.');e.status=r.status;throw e;}if(!data||typeof data!=='object')throw Error('Neyvu returned an unreadable response. Check the connection and try again.');return data;}
 async preflight(){
  const [browser,service]=await Promise.all([this.checkBrowser(),this.checkService(ORIGIN)]);
  if(service.ok&&service.web)this.web=service.web;
  const checks=[{name:'Files',state:'pass',detail:'Copied files passed their integrity check.'},{name:'Moodle browser',state:browser?'pass':'fail',detail:browser?browser.name+' is installed.':'Install Microsoft Edge, or Google Chrome on a Mac, before connecting Moodle.'},{name:'Neyvu',state:service.ok?'pass':'fail',detail:service.label},{name:'Moodle identity',state:this.state?.identity?'saved':'pending',detail:this.state?.identity?'Saved identity; confirm against the current Moodle session.':'Sign in and confirm your Moodle account.'},{name:'AI assistant',state:'pending',detail:'Readiness has not been verified.'}];
  if(this.state?.token&&service.ok){try{const health=await this.request('/api/beta/companion?op=status',{},this.state.token);checks[3]={name:'Moodle identity',state:health.moodle_identity?'saved':'pending',detail:health.moodle_identity?'Vault identity is pinned; confirm this session uses that account.':'No Moodle pages imported yet.'};checks[4]={name:'AI assistant',state:health.assistant==='ready'?'pass':'warn',detail:health.assistant==='ready'?'Worker heartbeat ready; accuracy gate is separate.':'Assistant '+health.assistant+'. Notes and sources remain usable.'};}catch(e){checks.push({name:'Laptop grant',state:e.status===401?'fail':'warn',detail:e.status===401?'Connection expired or revoked. Reconnect Neyvu.':'Current server does not provide the new connection preflight; grant and AI readiness remain unverified.'});}}
  this.update({checks});if(!browser||!service.ok){this.update({stage:'preflight',title:'Finish the setup checks.',detail:!browser?checks[1].detail:service.label});return false;}
  const expired=checks.some(c=>c.name==='Laptop grant'&&c.state==='fail');
  this.update({stage:this.state&&!expired?'resume':'welcome',title:expired?'Reconnect Neyvu.':this.state?'Ready to check Moodle.':'Setup checks passed.',detail:expired?'This laptop connection expired or was revoked. Connect Neyvu and choose your invited Google account.':this.state?'Open Moodle and confirm the account before refreshing.':'Connect your Neyvu account. Google will ask you to choose an account.'});return true;
 }
 // Rechecked before each sign-in so a website move after startup does not reject the browser's hand-off.
 async handoffOrigin(){try{const service=await this.checkService(ORIGIN);if(service.ok&&service.web)this.web=service.web;}catch{}return this.web;}
 async reset(){
  if(this.busy||this.pairing)throw Error('Wait for the current connection or refresh to finish before resetting.');
  const hadGrant=!!this.state?.token;
  if(this.state?.token)try{await this.request('/api/beta/companion?op=disconnect',{},this.state.token);}catch(e){if(e.status!==401)throw Error('Neyvu could not confirm disconnection. Your saved connection is retained. Check internet and retry, or disconnect this laptop on the website first.');}
  await this.pause();await this.clearProfile();this.pendingIdentity=null;this.pendingCourses=null;this.state=null;await this.save(null);
  this.update({checks:(this.status.checks||[]).map(c=>['Moodle identity','AI assistant','Laptop grant'].includes(c.name)?{...c,state:'pending',detail:'Check after reconnecting.'}:c),stage:'welcome',account:null,identity:null,lastCheck:null,diagnostics:null,collectedCourses:[],pendingOriginals:0,collectionIssues:[],courseChoices:[],listingIssues:[],title:'Choose your account again.',detail:(hadGrant?'Laptop disconnection is confirmed. ':'No readable laptop grant was available. Disconnect any old laptop entries you recognize on the Neyvu website. ')+'Local pairing and the isolated Moodle browser sign-in were cleared. Google account selection runs on reconnect. Existing cloud imports and their Moodle account are preserved.'});
 }
 async chooseMoodlePage(){
  if(!this.context)throw Error('Open the Moodle window first.');
  const candidates=this.context.pages().filter(p=>!p.isClosed()).filter(p=>{try{const u=new URL(p.url());return u.origin===MOODLE&&(u.pathname.startsWith('/my/')||!!readURL(u.href)||u.pathname==='/user/profile.php');}catch{return false;}});
  if(!candidates.length)throw Error('Finish signing in in the Companion Moodle window, then choose Check Moodle account. An ordinary Edge window is separate.');
  let chosen=candidates.includes(this.page)?this.page:candidates[0];
  for(const p of candidates){const dom=await p.evaluate(pageDOM);try{accountIdentity(dom);chosen=p;break;}catch{}}
  this.page=chosen;return chosen;
 }
 async checkedDOM(page,{probe=true}={}){
  const dom=await page.evaluate(pageDOM);this.update({diagnostics:{release:RELEASE,step:'Moodle identity',...identityDiagnostics(dom)}});try{accountIdentity(dom);return dom;}catch(error){
   if(!probe)throw error;
   // A missing menu is recoverable; contradictory/malformed identifiers are not.
   if(dom.runtime_user_id&&!/^[1-9]\d{0,11}$/.test(dom.runtime_user_id))throw error;
   let linked;
   if(dom.account_url){let link;try{link=new URL(dom.account_url);}catch{throw error;}linked=link.searchParams.get('id');if(link.origin!==MOODLE||!/^\/user\/(profile|view)\.php$/.test(link.pathname)||link.hash||link.username||link.password||[...link.searchParams.keys()].some(k=>k!=='id')||link.searchParams.getAll('id').length>1||linked!==null&&!/^[1-9]\d{0,11}$/.test(linked))throw error;}
   if(linked&&dom.runtime_user_id&&linked!==dom.runtime_user_id)throw error;
   // Navigate only to Moodle's own parameterless self-profile. It identifies
   // the session even when a custom theme has no Profile link in its menu.
   let u;try{u=new URL(dom.url);}catch{throw error;}
   if(u.origin!==MOODLE||u.pathname.startsWith('/login/')||/\b(?:notloggedin|guestuser)\b/.test(dom.classes||''))throw error;
   const context=this.context,profile=await context.newPage();
   try{await profile.goto(MOODLE+'/user/profile.php',{waitUntil:'domcontentloaded',timeout:15000});const own=await profile.evaluate(pageDOM),identity=selfProfileIdentity(own),id=identityKey(identity);this.update({diagnostics:{release:RELEASE,step:'Moodle self-profile',...identityDiagnostics(own)}});
    const fresh=await page.evaluate(pageDOM);
    if(this.context!==context||fresh.url!==dom.url)throw new MoodleIdentityError('Moodle changed while checking. No material was uploaded.');
    for(const observed of [dom,fresh]){
     if(observed.account_label?.trim()&&own.account_label?.trim()!==observed.account_label.trim()||observed.runtime_user_id&&observed.runtime_user_id!==id)throw new MoodleIdentityError('Moodle account changed while checking. No material was uploaded.');
     // Revalidate every newly exposed menu field; the profile cannot conceal
     // a contradictory account ID, signed-out marker or malformed URL.
     const checked=accountIdentity({...observed,account_label:own.account_label,...(!observed.runtime_user_id?{runtime_user_id:id}:{})});
     if(identityKey(checked)!==id)throw new MoodleIdentityError('Moodle account changed while checking. No material was uploaded.');
    }
    return {...fresh,account_label:own.account_label,account_url:MOODLE+'/user/profile.php?id='+id};}
   finally{await profile.close();await page.bringToFront().catch(()=>{});}
  }
 }
 watchMoodle(){
  clearInterval(this.identityTimer);
  this.identityTimer=setInterval(async()=>{
   if(this.identityChecking||this.busy||this.status.stage!=='sign-in')return;
   this.identityChecking=true;
   try{await this.checkAccount();}
   catch(error){
    if(this.resumeRequested&&!(error instanceof MoodleSessionExpiredError)&&(error instanceof MoodleIdentityError||error.status===401)){
     this.resumeRequested=false;
     clearInterval(this.identityTimer);
     this.fail(error);
    }
   }finally{this.identityChecking=false;}
  },3000);
  this.identityTimer.unref?.();
 }
 async init(){this.state=await this.load();if(this.state)this.update({...(this.status.stage==='checking'?{}:{stage:'resume',title:'Ready to refresh.',detail:'Your connection is saved on this laptop account.'}),account:this.state.account_label,lastCheck:this.state.lastCheck,lastRefresh:this.state.lastRefresh});}
 async pair(code){if(this.busy||this.pairing)throw Error('Wait for the current refresh to finish before reconnecting.');this.pairing=true;try{const state=await this.request('/api/beta/companion?op=redeem',{code});await this.pause();this.pendingIdentity=null;this.pendingCourses=null;this.state=state;await this.save(this.state);this.update({stage:'moodle',title:'Account connected.',account:this.state.account_label,identity:null,lastCheck:null,collectedCourses:[],pendingOriginals:0,collectionIssues:[],courseChoices:[],listingIssues:[],detail:'Next, open your separate Moodle window. Its sign-in will be detected; you confirm the account before import.'});}finally{this.pairing=false;}}
 async openMoodle(){if(!this.state)throw Error('Connect your Neyvu account first.');if(this.context){
  // Showing the owned window must also work during Moodle login or an SSO
  // redirect. The later account check still requires a verified Moodle page.
  const pages=this.context.pages().filter(page=>!page.isClosed());
  this.page=pages.includes(this.page)?this.page:pages[0]||await this.context.newPage();
  if(!pages.length)await this.page.goto(MOODLE+'/my/courses.php',{waitUntil:'domcontentloaded'});
  await this.page.bringToFront();if(this.status.stage==='courses')return;this.update({stage:'sign-in',title:'Check your Acadia Moodle sign-in.',detail:'Waiting to detect your signed-in account. You can also choose Check Moodle account.'});this.watchMoodle();return;}
  const browser=await this.checkBrowser();
  if(!browser?.executablePath)throw Error('Install Microsoft Edge, or Google Chrome on a Mac, then choose Open Moodle again.');
  this.context=await chromium.launchPersistentContext(join(this.root,'moodle-browser'),{executablePath:browser.executablePath,headless:false,acceptDownloads:false,serviceWorkers:'block'});
  await this.context.route('**/*',collectionRequestGuard(()=>this.busy,(url,error)=>{this.navigationFailure={url,error};},url=>url===this.membershipURL));
  this.context.on('close',()=>{this.currentFileAbort?.abort();this.context=null;this.page=null;clearInterval(this.timer);clearInterval(this.identityTimer);this.update({stage:'resume',title:'Updates paused.',detail:'The Moodle window was closed. Open it again to continue.'});});
  this.page=this.context.pages()[0]||await this.context.newPage();await this.page.goto(MOODLE+'/my/courses.php',{waitUntil:'domcontentloaded'});
  this.update({stage:'sign-in',title:'Sign in to Acadia Moodle.',detail:'Use the separate '+browser.name+' window. When your courses appear, keep this window open. The Companion will detect sign-in and ask you to confirm your account.'});this.watchMoodle();
 }
 async collectCourseMembership(course,state){
  const context=this.context,url=courseMembershipURL(course.id,state.identity),profile=await context.newPage();
  this.membershipURL=url;
  try{
   await profile.goto(url,{waitUntil:'domcontentloaded',timeout:15000});
   await profile.locator('#region-main').waitFor({timeout:10000});
   const before=await this.checkedDOM(profile),dom=await profile.evaluate(courseMembershipDOM),after=await this.checkedDOM(profile);
   if(this.context!==context||this.state!==state||!this.busy)throw new MoodleIdentityError('The connection changed during group detection.');
   const proof=makeCourseMembership(dom,before,after,course,state.identity);
   const saved=await this.request('/api/beta/companion?op=membership',proof,state.token);
   if(saved?.saved!==true)throw Error('Neyvu did not confirm the saved group check.');
  }finally{this.membershipURL=null;await profile.close();}
 }
 async resumeSavedConnection(){
  if(!this.state?.identity||!this.selectedCourses(this.state))return false;
  this.resumeRequested=true;
  await this.openMoodle();
  // A signed-out session remains in the ordinary sign-in screen. The watcher
  // resumes only the already confirmed identity and exact server selection.
  try{await this.checkAccount();}catch(error){
   if(error instanceof MoodleIdentityError&&!(error instanceof MoodleSessionExpiredError)){this.resumeRequested=false;this.fail(error);}
  }
  return true;
 }
 async checkAccount(){
  if(!this.context)throw Error('Open the Moodle window first, then sign in and choose Check Moodle account.');
  const state=this.state,context=this.context;
  const page=await this.chooseMoodlePage(),dom=await this.checkedDOM(page),identity=accountIdentity(dom);
  if(!state||this.state!==state||this.context!==context)throw Error('The connection changed during the account check. Check your sign-in again.');
  if(state.identity&&identityKey(state.identity)!==identityKey(identity))throw new MoodleIdentityError('This is a different Moodle account. Use the original account. Resetting the local connection does not erase the vault’s Moodle identity.');
  if(this.resumeRequested&&state.identity&&identityKey(state.identity)===identityKey(identity)){
   const server=await this.request('/api/beta/companion?op=status',{},state.token),current=server.current_courses,selected=this.selectedCourses(state);
   if(this.state!==state||this.context!==context)throw new MoodleIdentityError('The connection changed during startup. Confirm Moodle again.');
   if(!this.resumeRequested)return;
   this.resumeRequested=false;clearInterval(this.identityTimer);
   if(!current?.confirmed||!selected||current.revision!==state.course_selection.server_revision||!Array.isArray(current.moodle_ids)||current.moodle_ids.length!==selected.size||new Set(current.moodle_ids).size!==selected.size||!current.moodle_ids.every(id=>selected.has(id))){
    this.pendingIdentity=identity;this.needsConfirmation=true;this.update({stage:'confirm',identity,title:'Review your Moodle connection.',detail:'Your current course selection changed. Confirm your account and review courses before refreshing.'});return;
   }
   this.needsConfirmation=false;this.checkStatus('Moodle identity','pass','Saved Moodle account verified against the current signed-in session.');
   await this.refresh({trigger:'startup'});return;
  }
  this.pendingIdentity=identity;clearInterval(this.identityTimer);
  this.checkStatus('Moodle identity','pending','Signed-in account detected; waiting for your confirmation.');
  this.update({stage:'confirm',title:'Is this your Moodle account?',identity,detail:'Confirm this Moodle account belongs in the Neyvu account shown above. In Moodle, choose In progress and clear the course search. Next you will review your current lectures and labs before any import.'});
 }
 async confirm(){if(!this.pendingIdentity)throw Error('Check your Moodle sign-in first.');const state=this.state,current=accountIdentity(await this.checkedDOM(await this.chooseMoodlePage()));if(!state||this.state!==state)throw Error('The connection changed during confirmation. Check your sign-in again.');if(identityKey(current)!==identityKey(this.pendingIdentity)){this.pendingIdentity=null;throw Error('Moodle changed since the confirmation screen. Choose Check Moodle account again.');}this.state.identity=current;this.needsConfirmation=false;await this.save(this.state);this.checkStatus('Moodle identity','pass','Current signed-in account confirmed. Choose current courses before importing.');await this.prepareCourses();}
 async checkAssignmentsWhileIdle(){
  if(this.assignmentChecksSupported!==true||this.busy||this.pairing||!this.context||!this.state?.identity||this.needsConfirmation||this.status.stage!=='connected')return;
  const state=this.state,context=this.context,courses=this.selectedCourses(state);if(!courses)return;
  this.busy=true;
  try{
   await this.checkQueuedAssignment(state,context,courses,async(url,course)=>{
    this.navigationFailure=null;try{await this.page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});}catch(error){throw this.navigationFailure?.url===url?this.navigationFailure.error:error;}
    await this.page.locator('#region-main').waitFor({timeout:10000});
    const dom=await this.checkedDOM(this.page);makeCapture(dom,course,state.identity);
    if(this.state!==state||this.context!==context||dom.url!==url)throw new MoodleIdentityError('The connection changed during the assignment check.');return dom;
   },async(dom,course)=>{const saved=await this.request('/api/beta/companion',captureForService(makeCapture(dom,course,state.identity),this.captureCapabilities),state.token);if(saved?.saved!==true)throw Error('Neyvu did not confirm the saved assignment.');});
  }catch(error){
   if(error instanceof MoodleSessionExpiredError){this.needsConfirmation=true;this.resumeRequested=true;this.update({stage:'sign-in',title:'Sign in to Moodle to resume.',detail:'Your assignment check is saved. Sign into the same Moodle account to continue.'});this.watchMoodle();}
   else if(error instanceof MoodleIdentityError||[401,409].includes(error.status))this.fail(error);
   else this.update({assignmentCheck:{state:'waiting'},detail:'Your assignment check is saved. Companion will retry while Moodle stays open.'});
  }finally{this.busy=false;}
 }
 schedule(continuation=false,nextAt=null){clearInterval(this.timer);const due=nextAt||Date.now()+(continuation?5000:20*60*1000);this.update({nextRefreshAt:new Date(due).toISOString(),nextRefreshIsContinuation:continuation});this.timer=setTimeout(async()=>{
  if(!continuation&&this.assignmentChecksSupported===true&&Date.now()<due){await this.checkAssignmentsWhileIdle();if(this.context&&this.state&&!this.needsConfirmation&&this.status.stage==='connected')this.schedule(false,due);else if(this.context&&this.state&&this.status.stage==='error'&&this.status.retry==='refresh')this.schedule(false,due);return;}
  this.update({nextRefreshAt:null});
  const cycle=this.state?.collection_memory?.cycle;
  if(continuation&&(!cycle||Date.now()-cycle.started>=60*60*1000||cycle.pass>=MAX_COLLECTION_PASSES)){
   this.update({continuationPending:false,title:'Your saved course material is available.',detail:'Automatic continuation reached its safety limit. Review the remaining collection checks, then refresh.'});this.schedule();return;
  }
  this.refresh({continuation,trigger:'automatic'}).catch(()=>{});
 },continuation?5000:this.assignmentChecksSupported===true?Math.min(15000,Math.max(0,due-Date.now())):Math.max(0,due-Date.now()));this.timer.unref?.();}
 async visibleCourses(page,state){
  const courses=new Map(),seen=new Set();let listingIssues=[],grouping=null;
  const checked=async()=>{const dom=await this.checkedDOM(page);if(identityKey(accountIdentity(dom))!==identityKey(state.identity))throw new MoodleIdentityError('Moodle sign-in changed or expired. Sign in to your original account and try again.');return dom;};
  const controls=async()=>{const c=await page.evaluate(courseListingDOM);if(c.ambiguous)throw Error('Moodle shows more than one course list. Check your course list before importing.');if(c.unsupportedNext)throw Error('Moodle uses an unsupported course paging control. In the Companion Moodle window, choose Show All on the paging control, then reload the course list.');if(c.standard&&c.search.trim())throw Error('Clear the course search in the Companion Moodle window, then reload the course list. Review your current lectures and labs before importing.');const current=c.standard?c.grouping:'unknown';if(grouping!==null&&grouping!==current)throw Error('The Moodle course filter changed while reading the list. Reload it before choosing courses.');grouping=current;return c;};
  const turn=async(control,c)=>{const previousLinks=c.links.filter(l=>readURL(l.url,true)).map(l=>l.url).sort().join('|');await page.locator('#region-main [data-region="myoverview"] [data-region="paging-bar"] [data-control="'+control+'"] a[href="#"]').click({timeout:10000});await page.waitForFunction(({previous,previousLinks})=>{const root=document.querySelector('#region-main [data-region="myoverview"]'),links=[...root?.querySelectorAll('[data-region="courses-view"] a[href]')||[]].filter(a=>a.getClientRects().length&&/\/course\/view\.php\?id=\d/.test(a.href)).map(a=>a.href).sort().join('|');return root?.querySelector('[data-region="paging-bar"]')?.getAttribute('data-active-page-number')!==previous&&!!links&&links!==previousLinks;},{previous:c.page,previousLinks},{timeout:20000});};
  await checked();let c=await controls();if(c.first){await turn('first',c);await checked();c=await controls();}
  for(let i=0;i<MAX_COURSE_LIST_PAGES;i++){
   const dom=await checked();c=await controls();const found=[];
   for(const link of c.standard?c.links:dom.links){const url=readURL(link.url,true);if(url&&link.title.trim()){const id=new URL(url).searchParams.get('id');found.push(id);if(!courses.has(id))courses.set(id,{id,url,title:link.title.trim().slice(0,180),...(c.standard&&c.grouping==='inprogress'&&link.card_id===id&&/^(?:labs?|laborator(?:y|ies))$/i.test(link.category||'')?{active_lab:{category:link.category}}:{})});}}
   if(courses.size>MAX_REVIEW_COURSES)throw Error('This course review supports up to '+MAX_REVIEW_COURSES+' visible course cards. Choose In progress in Moodle and reload the list. You can select up to 40 current courses.');
   const key=[...new Set(found)].sort().join(',');if(seen.has(key)&&c.next)throw Error('Moodle course pagination did not advance. Check the course list and try Refresh now again.');seen.add(key);
   if(!c.next){if(c.otherPagination)listingIssues.push('This course list uses unsupported pagination. Only the visible course cards were checked; compare every course and lab.');return {courses,listingIssues,grouping};}
   if(i===MAX_COURSE_LIST_PAGES-1)throw Error('Moodle course pagination exceeded the safe page limit. Check your course list before importing.');
   await turn('next',c);
  }
 }
 selectedCourses(state=this.state){
  const selection=state?.course_selection;
  if(!selection||typeof selection!=='object'||Array.isArray(selection)||typeof selection.identity_key!=='string'||selection.identity_key!==identityKey(state.identity)||!Array.isArray(selection.courses)||!selection.courses.length||selection.courses.length>40)return null;
  const courses=new Map();
  for(const course of selection.courses){if(!course||typeof course!=='object'||Array.isArray(course)||typeof course.id!=='string'||!/^[1-9]\d{0,11}$/.test(course.id)||typeof course.title!=='string'||!course.title.trim()||course.title.length>180||typeof course.url!=='string'||readURL(course.url,true)!==course.url||new URL(course.url).searchParams.get('id')!==course.id||courses.has(course.id))return null;courses.set(course.id,{id:course.id,url:course.url,title:course.title});}
  return courses;
 }
 async discoverActiveLabs(state,context,courses,current){
  // Only a complete standard In progress overview can add courses. Existing
  // choices, including a previously unchecked lab, are never inferred away.
  await this.page.goto(MOODLE+'/my/courses.php',{waitUntil:'domcontentloaded',timeout:20000});
  await this.page.waitForFunction(courseListingReadyDOM,{},{timeout:20000});
  const list=await this.visibleCourses(this.page,state);
  if(list.grouping!=='inprogress'||list.listingIssues.length||!list.courses.size)return courses;
  if(this.state!==state||this.context!==context||identityKey(accountIdentity(await this.checkedDOM(this.page)))!==identityKey(state.identity))throw new MoodleIdentityError('The connection changed during lab discovery.');
  const previous=state.course_selection;
  if(!Array.isArray(previous.reviewed_ids)){previous.reviewed_ids=[...new Set([...courses.keys(),...list.courses.keys()])];await this.save(state);return courses;}
  const reviewed=new Set(previous.reviewed_ids);
  const added=[...list.courses.values()].filter(c=>!courses.has(c.id)&&!reviewed.has(c.id)&&c.active_lab);
  if(!added.length)return courses;
  if(courses.size+added.length>40)throw Error('A new active lab needs review because the forty-course limit was reached.');
  const pending=state.pending_lab_addition;
  const ids=added.map(c=>c.id).sort().join(',');
  const proof=pending&&pending.labs.map(c=>c.id).sort().join(',')===ids?pending:{identity:state.identity,expected_revision:current.revision,captured_at:new Date().toISOString(),grouping:'inprogress',complete:true,labs:added.map(c=>({id:c.id,category:c.active_lab.category}))};
  state.pending_lab_addition=proof;await this.save(state);
  const result=await this.request('/api/beta/companion?op=labs',proof,state.token),next=result.current_courses;
  const combined=new Map([...courses,...added.map(c=>[c.id,c])]);
  if(!result.saved||!next?.confirmed||!Array.isArray(next.moodle_ids)||next.moodle_ids.length!==combined.size||!next.moodle_ids.every(id=>combined.has(id))||typeof next.revision!=='string')throw Error('Neyvu did not confirm the newly active labs. Your saved selection is kept.');
  if(this.state!==state||this.context!==context)throw new MoodleIdentityError('The connection changed while saving active labs.');
  state.course_selection={...previous,courses:[...combined.values()],server_revision:next.revision,reviewed_ids:[...new Set([...reviewed,...list.courses.keys()])],reviewed_at:next.reviewed_at};
  delete state.pending_lab_addition;await this.save(state);
  this.update({addedLabs:added.map(c=>({id:c.id,title:c.title})),detail:'Moodle lists '+added.length+' newly active lab(s). They were added to your saved courses.'});
  return combined;
 }
 async checkQueuedAssignment(state,context,courses,read,save){
  const result=await this.request('/api/beta/companion?op=check.claim',{},state.token),job=result.check;
  if(!job)return;
  const course=courses.get(job.course_id),u=readURL(job.url);
  if(this.state!==state||this.context!==context||!course||!u||new URL(u).pathname!=='/mod/assign/view.php'||job.identity_key!==identityKey(state.identity)||typeof job.lease!=='string')throw new MoodleIdentityError('The requested assignment check does not match this connection.');
  this.update({assignmentCheck:{id:job.id,state:'checking'},title:'Checking your requested assignment…'});
  try{
   const dom=await read(u,course);await save(dom,course);
   await this.request('/api/beta/companion?op=check.finish',{id:job.id,lease:job.lease},state.token);
   this.update({assignmentCheck:{id:job.id,state:'complete'},title:'Assignment check saved.'});
  }catch(error){
   // A crash, expired session or uncertain acknowledgement leaves the durable
   // lease recoverable. No success is inferred from merely visiting the page.
   this.update({assignmentCheck:{id:job.id,state:'waiting'}});throw error;
  }
 }
 async prepareCourses(draftIds){
  if(this.busy||this.pairing)throw Error('Wait for the current collection to finish before choosing courses.');
  if(!this.context||!this.state?.identity||this.needsConfirmation)throw Error('Open Moodle and confirm your account before choosing courses.');
  const oldReview=this.pendingCourses;
  if(draftIds!==undefined&&(!oldReview||oldReview.state!==this.state||oldReview.context!==this.context||!Array.isArray(draftIds)||draftIds.length>40||new Set(draftIds).size!==draftIds.length||draftIds.some(id=>typeof id!=='string'||!oldReview.courses.has(id))))throw Error('Reload the reviewed course list before restoring these choices.');
  const draft=draftIds===undefined?null:new Set(draftIds);
  clearInterval(this.timer);this.timer=null;this.pendingCourses=null;this.busy=true;
  const state=this.state,context=this.context;
  try{
   this.update({stage:'reading-courses',progress:null,courseChoices:[],collectedCourses:[],listingIssues:[],title:'Finding courses for your review…',detail:'No course material is being imported. Moodle’s In progress filter is recommended; you choose the final list.'});
   const readList=async()=>{
    await this.page.goto(MOODLE+'/my/courses.php',{waitUntil:'domcontentloaded',timeout:20000});
    await this.page.locator('#region-main').waitFor({timeout:20000});
    try{await this.page.waitForFunction(courseListingReadyDOM,{},{timeout:20000});}
    catch{throw Error('Moodle’s course list has not finished loading. Wait for your courses in the Moodle window, then choose Reload course list. Your saved course selection is preserved.');}
    return this.visibleCourses(this.page,state);
   };
   let list=await readList();
   if(!list.courses.size&&this.selectedCourses(state)){
    if(this.state!==state||this.context!==context)throw new MoodleIdentityError('The connection changed while reading courses.');
    this.update({detail:'Moodle showed an empty list. Your saved course selection is kept while we check again.'});
    list=await readList();
    if(!list.courses.size)throw Error('Moodle still shows an empty list. Your saved course selection is kept. Check the course filter in Moodle, then reload the course list.');
   }
   const {courses,listingIssues,grouping}=list;
   const server=await this.request('/api/beta/companion?op=status',{},state.token),current=server.current_courses;
   if(!current||typeof current.confirmed!=='boolean'||current.confirmed&&!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(current.revision||''))throw Error('Neyvu needs the current-course update before import can continue. Your saved vault is preserved.');
   if(this.state!==state||this.context!==context)throw new MoodleIdentityError('The connection changed while reading courses. Confirm your Moodle account again.');
   const previous=this.selectedCourses(state),inProgress=grouping==='inprogress';
   this.pendingCourses={state,context,courses,grouping,listingIssues,expectedRevision:current.confirmed?current.revision:null};this.courseReview=(this.courseReview||0)+1;
   this.update({stage:'courses',title:'Choose your current courses.',detail:draft?'Your checkbox choices were kept where the courses remain visible. Check any newly shown active course or lab before importing.':inProgress?'Moodle’s In progress courses are checked. Review each lecture and lab. For a missing or undated active course, choose All in Moodle and reload this list.':'Only previously confirmed choices are checked. Select your current lectures and labs. Moodle’s In progress filter can help; names and years are never used to guess current courses.',courseReview:this.courseReview,courseFilter:grouping,courseChoices:[...courses.values()].map(course=>({...course,selected:draft?draft.has(course.id):inProgress||!!previous?.has(course.id)})),listingIssues});
  }finally{this.busy=false;}
 }
 async selectCourses(ids){
  if(this.busy||this.pairing)throw Error('Wait for the current step to finish before choosing courses.');
  const pending=this.pendingCourses,state=this.state,context=this.context;
  if(!pending||pending.state!==state||pending.context!==context||!context||this.needsConfirmation)throw Error('Reload the course list and confirm your Moodle account before choosing courses.');
  if(!Array.isArray(ids)||!ids.length||ids.length>40||ids.some(id=>typeof id!=='string'||!pending.courses.has(id))||new Set(ids).size!==ids.length)throw Error('Choose at least one current course from the reviewed list.');
  this.busy=true;
  try{
   const current=accountIdentity(await this.checkedDOM(await this.chooseMoodlePage()));
   if(this.state!==state||this.context!==context||identityKey(current)!==identityKey(state.identity))throw new MoodleIdentityError('Moodle account changed while choosing courses. No material was imported.');
   const sameAttempt=pending.saveAttempt&&pending.saveAttempt.ids.length===ids.length&&pending.saveAttempt.ids.every(id=>ids.includes(id));
   const selection=sameAttempt?pending.saveAttempt.selection:{identity_key:identityKey(current),reviewed_at:new Date().toISOString(),source:pending.grouping==='inprogress'?'moodle-inprogress':'user-reviewed',courses:ids.map(id=>pending.courses.get(id))};
   pending.saveAttempt={ids:[...ids],selection};
   const result=await this.request('/api/beta/companion?op=courses',{identity:current,course_ids:ids,reviewed_at:selection.reviewed_at,selection_source:selection.source,expected_revision:pending.expectedRevision},state.token),server=result.current_courses;
   if(!result.saved||!server?.confirmed||!Array.isArray(server.moodle_ids)||server.moodle_ids.length!==ids.length||new Set(server.moodle_ids).size!==ids.length||!server.moodle_ids.every(id=>ids.includes(id))||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(server.revision||''))throw Error('Neyvu could not confirm your chosen courses. Reload the list before importing.');
   if(this.state!==state||this.context!==context)throw new MoodleIdentityError('The connection changed while saving your courses. Confirm your Moodle account again.');
   selection.server_revision=server.revision;
   selection.reviewed_ids=[...pending.courses.keys()];state.course_selection=selection;await this.save(state);this.pendingCourses=null;
   this.update({courseChoices:[],courseFilter:pending.grouping,selectedCourseCount:ids.length});
  }finally{this.busy=false;}
  await this.refresh();
 }
 cancelRefresh(){
  if(!this.busy&&this.status.continuationPending){clearInterval(this.timer);this.timer=null;this.update({stage:'paused',continuationPending:false,partialSaved:true,title:'Import paused between batches.',detail:'Saved material is kept. Choose Retry selected courses to continue.',progress:{...this.status.progress,phase:'cancelled'}});return;}
  if(!this.busy||this.status.stage!=='collecting')return;
  this.cancelRequested=true;clearInterval(this.timer);this.timer=null;
  this.update({title:'Stopping after this page…',detail:'The current read and save will finish safely. Material already saved stays in your vault.',progress:{...this.status.progress,cancelRequested:true}});
 }
 async moodleFetch(url,options){
  if(new URL(url).origin!==MOODLE)throw Error('Unsupported Moodle file destination.');
  const now=Date.now()/1000,u=new URL(url),cookies=await this.context.cookies(url);
  const cookie=cookies.filter(c=>{const domain=c.domain.replace(/^\./,'');return (u.hostname===domain||c.domain.startsWith('.')&&u.hostname.endsWith('.'+domain))&&(!c.secure||u.protocol==='https:')&&(c.expires<0||c.expires>now)&&(u.pathname===c.path||u.pathname.startsWith(c.path.endsWith('/')?c.path:c.path+'/'))&&!/[\r\n;]/.test(c.name+c.value);}).map(c=>c.name+'='+c.value).join('; ');
  try{return await fetch(url,{...options,headers:cookie?{Cookie:cookie}:{}});}catch(error){error.retryable=true;throw error;}
 }
 async uploadAttachment(file,course,identity,token){
  const metadata={identity,course:{id:course.id,url:course.url},source_url:file.source_url,title:file.title,mime:file.mime,captured_at:new Date().toISOString(),sha256:file.sha256,...(file.activity_url?{activity_url:file.activity_url}:{})};
  if(file.mime==='application/pdf'&&this.deviceContent){
   const state=this.state,context=this.context,revision=state?.course_selection?.server_revision;
   const assertCurrent=()=>{if(this.state!==state||this.context!==context||state?.token!==token||identityKey(state?.identity)!==identityKey(identity)||state?.course_selection?.server_revision!==revision||!this.selectedCourses(state)?.has(course.id))throw new MoodleIdentityError('The connection or course review changed. The retained PDF was not rebound; confirm your account and courses.');};
   const controller=new AbortController();this.currentFileAbort=controller;let result;
   try{result=await this.deviceContent({file,metadata,token,courseTitle:course.title,reviewRevision:revision,assertCurrent,signal:controller.signal});if(controller.signal.aborted)throw Error('PDF reading stopped. The retained original and saved progress are kept.');}finally{if(this.currentFileAbort===controller)this.currentFileAbort=null;}
   if(result?.supported===true){if(result.saved!==true||!result.receipt||result.original_cleanup_allowed!==false)throw Error('Neyvu did not confirm the retained PDF. Keep the original.');return result;}
   if(result?.supported!==false)throw Error('Neyvu could not confirm this PDF transfer. Keep the original.');
  }
  let response;try{response=await fetch(ORIGIN+'/api/beta/companion?op=file',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':file.mime,'X-SchoolVault-Capture':Buffer.from(JSON.stringify(metadata)).toString('base64url')},body:file.body,signal:AbortSignal.timeout(30000),redirect:'error'});}catch(error){error.retryable=true;throw error;}
  const data=await response.json().catch(()=>null);if(!response.ok){const error=Error(data?.error||'Neyvu could not save this original file.');error.status=response.status;throw error;}
  if(!data||!data.saved)throw Error('Neyvu did not confirm the saved original file.');return data;
 }
 async refresh({continuation=false,trigger='manual'}={}){if(this.busy)return;if(!this.context||!this.state?.identity||this.needsConfirmation)throw Error('Open Moodle and confirm your account first.');continuation=continuation||this.status.stage==='paused';this.busy=true;this.cancelRequested=false;clearInterval(this.timer);this.timer=null;
  const started_at=new Date().toISOString();
  const state=this.state,context=this.context;let pages=0,attempts=0,issues=0,index=0,totalFiles=0,totalFileAttempts=0,totalBytes=0,lastSavedAt=null,currentCourse='',currentPage='';
  const collectedCourses=[],collectionIssues=[],courseIssues=[],fileSeen=new Set(),gapKeys=new Set(),originals=new Map(),coursePages=new Map(),allCourseIssues=new Map(),gapCounts=new Map(),parentIssues=new Map();let memory,courses,cycle,captureCapabilities;const nodes=new Map();let activeNode=null;
  const progress=(phase='reading')=>this.update({progress:{phase,currentCourse,currentPage,index,total:this.selectedCourses(state)?.size||0,pagesSaved:pages,pagesAttempted:attempts,gaps:issues,lastSavedAt,updatedAt:new Date().toISOString(),filesSaved:totalFiles,pass:cycle?.pass||1,cancelRequested:this.cancelRequested},collectionIssues:[...collectionIssues],collectedCourses:[...collectedCourses]});
  const gap=(reason,url=courseURL(),title=currentPage)=>{const detail=collectionIssue(reason),key=this.activeCourse?.id+'|'+url+'|'+detail.code+'|'+detail.reason;if(gapKeys.has(key))return;gapKeys.add(key);issues++;const id=this.activeCourse?.id;if(id){const reasons=allCourseIssues.get(id)||new Set();reasons.add(detail.reason);allCourseIssues.set(id,reasons);gapCounts.set(id,(gapCounts.get(id)||0)+1);}if(courseIssues.length<30)courseIssues.push(detail.reason);if(collectionIssues.length<60)collectionIssues.push({course_id:this.activeCourse?.id,course:currentCourse,title,url,...detail});progress();};
  const courseURL=()=>this.activeCourse?.url||'';
  const boundary=()=>{if(this.state!==state||this.context!==context)throw new MoodleIdentityError('The connection changed during collection. Confirm your Moodle account again.');if(this.cancelRequested)throw Object.assign(Error('Collection stopped.'),{cancelled:true});};
  const retryRead=async operation=>{for(let retry=0;;retry++){boundary();try{const result=await operation();boundary();return result;}catch(error){if(Number.isSafeInteger(error.bytesRead)&&error.bytesRead>0){totalBytes=Math.min(MAX_ATTACHMENT_RUN_BYTES,totalBytes+error.bytesRead);error.bytesRead=0;}if(error instanceof MoodleIdentityError||error.status===401||error.status===409)throw error;const temporary=error.name==='TimeoutError'||error.retryable===true||browserNetworkInterrupted(error)||/timed out|timeout|HTTP 5\d\d/.test(error.message||'');if(!temporary||retry>=2)throw error;this.update({title:'Retrying this Moodle read…'});progress('retrying');await new Promise(resolve=>setTimeout(resolve,100*(retry+1)));}}};
  const readPage=async(url,course)=>retryRead(async()=>{this.navigationFailure=null;try{await this.page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});}catch(error){throw this.navigationFailure?.url===url?this.navigationFailure.error:error;}await this.page.locator('#region-main').waitFor({timeout:10000});boundary();const dom=await this.checkedDOM(this.page);makeCapture(dom,course,state.identity);if(dom.url!==url)throw Error('Moodle redirected this page; its content was not collected.');return dom;});
  const expandSections=async(dom,course)=>{if(!dom.collapsed)return dom;makeCapture(dom,course,state.identity);const controls=await this.page.evaluate(sectionDisclosures);if(!Array.isArray(controls))return dom;for(const id of controls){boundary();const fresh=await this.checkedDOM(this.page);makeCapture(fresh,course,state.identity);if(fresh.url!==course.url)throw new MoodleIdentityError('The course changed before expanding its sections.');const visible=await this.page.evaluate(sectionDisclosures);if(!Array.isArray(visible)||!visible.includes(id))continue;try{await this.page.locator('#'+id).click({timeout:5000});await this.page.locator('#'+id+'[aria-expanded="true"]').waitFor({timeout:5000});}catch(error){if(error instanceof MoodleIdentityError)throw error;gap('A Moodle course section could not be expanded. Open it in Moodle and retry.',course.url);break;}}return await this.checkedDOM(this.page);};
  const savePage=async(dom,course,extra=[])=>{const capture=makeCapture(dom,course,state.identity);capture.coverage.issues=[...new Set([...capture.coverage.issues,...extra])].slice(0,30);progress('saving');const saved=await this.request('/api/beta/companion',captureForService(capture,captureCapabilities),state.token);if(saved?.saved!==true)throw Error('Neyvu did not confirm this saved Moodle page.');pages++;lastSavedAt=new Date().toISOString();progress();};
  const saveFile=async(file,course,title)=>{const key=course.id+'|'+file.source_url;if(fileSeen.has(key))return false;attachmentCandidates(await this.checkedDOM(this.page),course,state.identity);progress('saving');await this.uploadAttachment({...file,title:title||file.title},course,state.identity,state.token);fileSeen.add(key);totalFiles++;lastSavedAt=new Date().toISOString();progress();return true;};
  const queueOriginal=(item,dom,course)=>{const key=originalKey(course.id,item.source_url||item.url);if(activeNode)activeNode.files.add(key);if(originals.has(key))return;if(originals.size>=4000){gap('The 4000 original links per refresh discovery limit was reached.',dom.url);return;}if(cycle.files[key])return;originals.set(key,{...item,key,course,parent_url:dom.url,ordinal:originals.size});};
  const readFiles=async(dom,course)=>{const candidates=attachmentCandidates(dom,course,state.identity,{discoverOnly:true,legacyPowerPoint:captureCapabilities?.legacy_powerpoint===1});for(const reason of candidates.issues)gap(reason,dom.url,currentPage);for(const item of candidates.items)queueOriginal(item,dom,course);return candidates.issues;};
  const recordFileIssues=async(dom,course,reasons,extra=[])=>{if(!reasons.length)return;const key=course.id+'|'+dom.url,accumulated=parentIssues.get(key)||new Set();for(const reason of [...extra,...reasons])accumulated.add(reason);parentIssues.set(key,accumulated);const capture=makeCapture(dom,course,state.identity);capture.coverage.issues=[...new Set([...capture.coverage.issues,...accumulated])].slice(0,30);progress('saving');const saved=await this.request('/api/beta/companion',captureForService(capture,captureCapabilities),state.token);if(saved?.saved!==true)throw Error('Neyvu did not confirm this saved coverage update.');progress();};
  const saveCheckpoint=async()=>{
   // Only acknowledged pages with all discovered children and originals can be skipped on resume.
   const reverseNodes=[...nodes.values()].reverse();
   for(let pass=0;pass<=reverseNodes.length;pass++){
    let changed=false;
    for(const node of reverseNodes){
     if(cycle.pages[node.key]||!node.saved||node.blocked)continue;
     if(![...node.files].every(key=>cycle.files[key])||![...node.children].every(key=>cycle.pages[key]))continue;
     cycle.pages[node.key]=true;
     if(node.key===originalKey(node.course,node.root))cycle.roots[node.key]=true;
     changed=true;
    }
    if(!changed)break;
   }
   await this.save(state);
  };
  try{
   courses=this.selectedCourses(state);if(!courses){this.busy=false;return await this.prepareCourses();}
   const service=await this.request('/api/beta/companion?op=status',{},state.token);let current=service.current_courses;captureCapabilities=service.capture_capabilities;this.captureCapabilities=captureCapabilities;this.assignmentChecksSupported=captureCapabilities?.assignment_checks===1;
   const pendingLab=state.pending_lab_addition,expectedIds=new Set([...courses.keys(),...(pendingLab?.labs||[]).map(l=>l.id)]);
   const pendingMatch=captureCapabilities?.active_labs===1&&pendingLab&&current?.confirmed&&Array.isArray(current.moodle_ids)&&current.moodle_ids.length===expectedIds.size&&new Set(current.moodle_ids).size===expectedIds.size&&current.moodle_ids.every(id=>expectedIds.has(id));
   if(!current?.confirmed||!Array.isArray(current.moodle_ids)||!pendingMatch&&(current.moodle_ids.length!==courses.size||new Set(current.moodle_ids).size!==courses.size||!current.moodle_ids.every(id=>courses.has(id))))throw Error('Current course choices changed or are not confirmed. Review your current courses again before importing.');
   if(captureCapabilities?.active_labs===1){try{courses=await this.discoverActiveLabs(state,context,courses,current);if(state.course_selection.server_revision!==current.revision)current={...current,revision:state.course_selection.server_revision,moodle_ids:[...courses.keys()]};}catch(error){if(error instanceof MoodleIdentityError||[401,409].includes(error.status))throw error;this.update({listingIssues:['New labs could not be checked: '+error.message]});}}
   if(current.moodle_ids.some(id=>!courses.has(id)))throw Error('Confirm the saved active lab addition before continuing collection.');
   memory=collectionMemory(state,courses,current.revision);cycle=collectionCycle(memory,{continuation});const priorProgress=Object.keys(cycle.pages).length+Object.keys(cycle.files).length;await this.save(state);
   this.update({stage:'collecting',continuationPending:false,collectedCourses:[],pendingOriginals:0,collectionIssues:[],partialSaved:false,content_readiness:null,title:'Reading instructions and materials…',detail:'Your selected courses are read page by page. Saved text becomes usable while original documents wait for text extraction.'});progress();
   const {page}=this;
   const fileAttempts=new Map(),visited=new Set();
   const collectOriginals=async(limit=MAX_ATTACHMENTS_PER_RUN,onlyCourse=null)=>{
    const stopAt=Math.min(MAX_ATTACHMENTS_PER_RUN,totalFileAttempts+limit);
    activeNode=null;let parent='';
   while(totalFileAttempts<stopAt&&totalFileAttempts<MAX_ATTACHMENTS_PER_RUN&&totalBytes<MAX_ATTACHMENT_RUN_BYTES){
    boundary();const eligible=onlyCourse?new Map([...originals].filter(([,job])=>job.course.id===onlyCourse)):originals;
    const chosen=chooseOriginal(eligible,memory,courses,fileAttempts,visited);if(!chosen)break;
    const {job,next}=chosen,course=job.course;this.activeCourse=course;currentCourse=course.title;currentPage=job.title;
    visited.add(job.key);fileAttempts.set(course.id,(fileAttempts.get(course.id)||0)+1);totalFileAttempts++;
    markOriginal(memory,job.key,next);await this.save(state);progress('reading');let checkedParent=null;
    try{
     if(parent!==job.parent_url){await readPage(job.parent_url,course);parent=job.parent_url;}
     const observed=await this.checkedDOM(page),fresh=job.parent_url===course.url?await expandSections(observed,course):observed,plan=attachmentCandidates(fresh,course,state.identity,{discoverOnly:true,legacyPowerPoint:captureCapabilities?.legacy_powerpoint===1});checkedParent=fresh;
     if(fresh.url!==job.parent_url||!(job.resource?(fresh.links||[]).some(link=>readURL(link.url)===job.url):plan.items.some(item=>item.source_url===job.source_url)))throw Error('The original link is no longer visible on this checked course page; it was not imported.');
     const file=await retryRead(()=>readAttachment(this.moodleFetch.bind(this),job.url,{remainingBytes:MAX_ATTACHMENT_RUN_BYTES-totalBytes,legacyPowerPoint:captureCapabilities?.legacy_powerpoint===1}));
     if(file.kind==='file'){totalBytes+=file.bytes;const saved=await saveFile(file,course,job.title);const row=collectedCourses.find(row=>row.id===course.id);if(row&&saved)row.files++;cycle.files[job.key]=true;await this.save(state);}
     else{
      await page.goto(job.url,{waitUntil:'domcontentloaded',timeout:20000});await page.locator('#region-main').waitFor({timeout:10000});parent=job.url;
      const activity=await this.checkedDOM(page);if(activity.url!==job.url)throw Error('Moodle redirected this resource page; its content was not collected.');
      activeNode=nodes.get(originalKey(course.id,job.url))||null;await savePage(activity,course);const row=collectedCourses.find(row=>row.id===course.id);if(row)row.pages++;await recordFileIssues(activity,course,await readFiles(activity,course));cycle.files[job.key]=true;await this.save(state);activeNode=null;
     }
    }catch(e){activeNode=null;parent='';if(e instanceof MoodleIdentityError||e.status===401||e.status===409)throw e;totalBytes=Math.min(MAX_ATTACHMENT_RUN_BYTES,totalBytes+(e.bytesRead||0));gap(e.message,job.url,currentPage);if(checkedParent)await recordFileIssues(checkedParent,course,[e.message]);}
   }
   };
   const queuedCheck=async()=>{if(captureCapabilities?.assignment_checks!==1)return;boundary();const previous=this.activeCourse;try{await this.checkQueuedAssignment(state,context,courses,async(url,course)=>{this.activeCourse=course;return readPage(url,course);},savePage);}catch(error){if(courseWideFailure(error))throw error;gap('Requested assignment check: '+error.message);}finally{this.activeCourse=previous;}};
   for(const course of courses.values()){
    boundary();this.activeCourse=course;currentCourse=course.title;currentPage=course.title;index++;courseIssues.length=0;const beforePages=pages,beforeIssues=issues,beforeFiles=totalFiles;
    this.update({title:'Reading '+course.title});progress();attempts++;
    activeNode=null;let dom,start;
    // A dropped, hidden or unreadable course is a gap for that course only. Account, grant,
    // cancellation, browser network/certificate and connection failures still stop the run as before.
    try{dom=await expandSections(await readPage(course.url,course),course);start=collectionStart(dom,{afterURL:memory.activities[course.id],isComplete:url=>!!cycle.roots[originalKey(course.id,url)]});}
    catch(error){if(courseWideFailure(error))throw error;gap('This course page could not be read: '+error.message+' Your other selected courses were still read.',course.url,course.title);collectedCourses.push({id:course.id,title:course.title,pages:0,gaps:issues-beforeIssues,files:0});progress();await queuedCheck();continue;}
    coursePages.set(course.id,{dom,course,extra:start.issues});
    if(dom.collapsed)gap('Some course sections are collapsed; compare Moodle for material that was not loaded.',course.url);
    for(const reason of start.issues)gap(reason,course.url);await savePage(dom,course,start.issues);await recordFileIssues(dom,course,await readFiles(dom,course),start.issues);
    if(captureCapabilities?.course_membership===1){
     try{await this.collectCourseMembership(course,state);}
     catch(error){if(error instanceof MoodleIdentityError||[401,409].includes(error.status))throw error;gap('Course groups: '+error.message,course.url);}
    }
    if(dom.calendar_links?.length){
     const calendarURL=MOODLE+'/calendar/view.php?view=upcoming&course='+course.id;
     try{const calendar=await readPage(calendarURL,course);await savePage(calendar,course);await recordFileIssues(calendar,course,await readFiles(calendar,course));}
     catch(error){if(error instanceof MoodleIdentityError||error.status===401||error.status===409)throw error;gap('Moodle Calendar: '+error.message,calendarURL);}
    }
    const queue=[...start.items],seen=new Set(queue.map(item=>item.url));let attempted=0,discussions=0,bookChapters=0,forumIndexes=0;
    for(let cursor=0;cursor<queue.length&&attempted<MAX_ACTIVITY_PAGES;cursor++){
     boundary();const item=queue[cursor],url=item.url;activeNode={key:originalKey(course.id,url),root:item.root||url,course:course.id,children:new Set(),files:new Set(),saved:false,blocked:false};nodes.set(activeNode.key,activeNode);attempted++;attempts++;currentPage='Activity '+attempted;progress();
     if(item.kind==='activity'&&item.depth===0){memory.activities[course.id]=url;await this.save(state);}
     else{markNestedPage(memory,course.id,url);await this.save(state);}
     try{
      if(new URL(url).pathname==='/mod/resource/view.php'){
       queueOriginal({url,title:'Course original',resource:true},{url:item.parent_url||dom.url},course);activeNode.saved=true;continue;
      }
      const activity=await readPage(url,course),capture=makeCapture(activity,course,state.identity);currentPage=capture.title;
      if(capture.url!==url)throw Error('Moodle redirected this activity to another page; its content was not collected.');
      // The base forum owns pagination links it currently displays. Its index
      // children must not each create the same omitted sibling dependency.
      let ownedPagination=item.ownedPagination||new Set();
      const activityURL=new URL(activity.url);
      if(activityURL.pathname==='/mod/forum/view.php'&&!activityURL.searchParams.has('page'))ownedPagination=new Set((activity.links||[]).filter(link=>link.collection_link!==false).map(link=>readURL(link.url)).filter(Boolean).filter(link=>{const u=new URL(link);return u.pathname===activityURL.pathname&&u.searchParams.get('id')===activityURL.searchParams.get('id')&&u.searchParams.has('page');}));
      const follow=collectionFollowups(activity,{depth:item.depth,seen,remaining:Math.max(0,MAX_ACTIVITY_PAGES-attempted),discussions,bookChapters,forumIndexes,lastAttempt:url=>memory.pages[originalKey(course.id,url)]||0,isComplete:url=>!!cycle.pages[originalKey(course.id,url)],ownedPagination});
      // Actual omitted/failed children remain course gaps. Pagination itself
      // is not a missing-content issue when its current plan has no omissions.
      activity.pagination_checked=follow.issues.length===0;
      for(const reason of follow.issues){gap(reason,url,capture.title);if(collectionIssue(reason).code==='budget')activeNode.blocked=true;}
      await savePage(activity,course,follow.issues);await recordFileIssues(activity,course,await readFiles(activity,course),follow.issues);
      activeNode.saved=true;for(const child of follow.items){seen.add(child.url);activeNode.children.add(originalKey(course.id,child.url));}discussions+=follow.added.discussions;bookChapters+=follow.added.bookChapters;forumIndexes+=follow.added.forumIndexes;
      queue.splice(cursor+1,0,...follow.items.map(child=>({...child,parent_url:activity.url,root:activeNode.root,ownedPagination})));
     }catch(e){if(activeNode)activeNode.blocked=true;if(e instanceof MoodleIdentityError||e.status===401||e.status===409)throw e;totalBytes=Math.min(MAX_ATTACHMENT_RUN_BYTES,totalBytes+(e.bytesRead||0));gap(e.message,url,currentPage);}
    }
    if(queue.length>attempted)gap('The 100 activity/discussion page limit was reached; some linked pages were not checked.',course.url);
    await recordFileIssues(dom,course,courseIssues,start.issues);
    collectedCourses.push({id:course.id,title:course.title,pages:pages-beforePages,gaps:issues-beforeIssues,files:totalFiles-beforeFiles});progress();
    // Make a bounded set of originals usable before a later course can stop
    // collection. Remaining originals retain the shared fair/bounded drain.
    await collectOriginals(5,course.id);
    await saveCheckpoint();
    await queuedCheck();
   }
   await collectOriginals();
   await saveCheckpoint();
   const pending=[...originals.values()].filter(job=>!visited.has(job.key));
   for(const job of pending){this.activeCourse=job.course;currentCourse=job.course.title;gap('The file collection budget was reached; this original is queued for a later refresh.',job.url,job.title);}
   for(const {dom,course,extra} of coursePages.values()){boundary();this.activeCourse=course;currentCourse=course.title;await recordFileIssues(dom,course,[...(allCourseIssues.get(course.id)||[])],extra);const row=collectedCourses.find(row=>row.id===course.id);if(row)row.gaps=gapCounts.get(course.id)||0;}
   this.update({pendingOriginals:pending.length});
   boundary();progress('checking');this.update({title:'Checking saved course material…'});
   const health=await this.request('/api/beta/companion?op=status',{},state.token),rows=(health.coverage||[]).filter(row=>courses.has(String(row.moodle_id))||health.current_courses?.course_ids?.includes(row.course_id));
   const readiness=rows.map(row=>({course_id:row.course_id,title:row.course_title||row.title||row.code||'Course',...row.readiness}));
   const readinessVerified=rows.length===courses.size&&rows.every(row=>row.readiness&&[row.readiness.readable_pages,row.readiness.title_or_link_only_pages,...['stored','readable','pending','failed','not_indexed','truncated'].map(key=>row.readiness.attachments?.[key])].every(n=>Number.isSafeInteger(n)&&n>=0));
   const content_readiness=readinessVerified?{courses:readiness,totalReadablePages:readiness.reduce((n,r)=>n+(r.readable_pages||0),0),totalTitleOnlyPages:readiness.reduce((n,r)=>n+(r.title_or_link_only_pages||0),0),attachmentsStored:readiness.reduce((n,r)=>n+(r.attachments?.stored||0),0),attachmentsReadable:readiness.reduce((n,r)=>n+(r.attachments?.readable||0),0),attachmentsPending:readiness.reduce((n,r)=>n+(r.attachments?.pending||0),0),attachmentsFailed:readiness.reduce((n,r)=>n+(r.attachments?.failed||0),0),limitations:[...new Set(readiness.flatMap(r=>r.limitations||[]))]}:null;
   const retryableWork=pending.length>0||collectionIssues.some(issue=>['budget','temporary'].includes(issue.code));const newProgress=Object.keys(cycle.pages).length+Object.keys(cycle.files).length-priorProgress;const continueCycle=retryableWork&&newProgress>0&&cycle.pass<MAX_COLLECTION_PASSES&&Date.now()-cycle.started<60*60*1000;cycle.resume=continueCycle;const verified=readinessVerified&&rows.every(row=>row.readiness.state==='readable'&&!Number(row.capture_issues))&&!issues&&!pending.length&&!content_readiness?.attachmentsPending&&!content_readiness?.attachmentsFailed&&!content_readiness?.totalTitleOnlyPages;state.lastCheck=new Date().toISOString();state.lastRefresh={trigger,started_at,completed_at:state.lastCheck,pages,files:totalFiles,gaps:issues,outcome:verified?'complete':'partial'};await this.save(state);progress(continueCycle?'continuing':content_readiness?.attachmentsPending?'indexing':verified?'complete':'partial');this.update({stage:'connected',title:continueCycle?'Continuing your Moodle import…':'Your saved course material is available.',continuationPending:continueCycle,detail:pages+' pages and '+totalFiles+' original files saved from '+courses.size+' courses.'+(content_readiness?.attachmentsPending?' '+content_readiness.attachmentsPending+' documents are waiting for text extraction.':'')+(pending.length?' '+pending.length+' originals remain for later refreshes.':'')+(issues?' '+issues+' collection checks need attention.':'')+(!readinessVerified?' Saved-text readiness could not be verified; check Sources for each file’s extraction status.':'')+(continueCycle?' The next batch starts automatically in five seconds. Keep Moodle open.':retryableWork?' Automatic continuation paused at its safety limit or because no new items were saved. Review the remaining checks, then retry.':'')+' Open sources to compare the saved evidence with Moodle.',content_readiness,collectedCourses,collectionIssues,lastCheck:state.lastCheck,lastRefresh:state.lastRefresh});this.schedule(continueCycle);
  }catch(e){
   clearInterval(this.timer);this.timer=null;
   let checkpointWarning='';
   if(cycle&&this.state===state&&this.context===context){
    try{await saveCheckpoint();}
    catch{checkpointWarning=' This laptop could not save its latest collection checkpoint.';}
   }
   if(e.cancelled){progress('cancelled');this.update({stage:'paused',continuationPending:false,partialSaved:true,title:'Collection stopped. Saved material is kept.',detail:pages+' pages and '+totalFiles+' originals were saved. Choose Refresh to continue reading your selected courses.'+checkpointWarning,collectedCourses,collectionIssues});return;}
   if(e instanceof MoodleSessionExpiredError&&this.context===context&&this.state===state&&state.course_selection?.server_revision){
    this.needsConfirmation=true;
    this.resumeRequested=true;
    this.pendingIdentity=null;
    progress('paused');
    this.update({stage:'sign-in',partialSaved:true,title:'Sign in to Moodle to resume.',detail:'Use the same Moodle account. The import resumes after Neyvu verifies it and the saved course selection.'+checkpointWarning});
    this.watchMoodle();
    return;
   }
   this.fail(e);if(checkpointWarning)this.update({detail:this.status.detail+checkpointWarning});progress();
   const retryable=!(e instanceof MoodleIdentityError)&&e.status!==401&&e.status!==409&&(e.retryable===true||e.name==='TimeoutError'||browserNetworkInterrupted(e)||e.status>=500&&e.status<=599);
   if(retryable&&this.context===context&&this.state===state&&state.identity){this.schedule();this.update({retry:'refresh',detail:this.status.detail+' Automatic refresh will retry in twenty minutes while this Moodle window stays open.'});}
   else{this.pendingIdentity=null;this.needsConfirmation=true;}
  }finally{this.busy=false;this.activeCourse=null;}
 }
 fail(e){let detail=e.message||'The connection could not finish.';if(browserNetworkInterrupted(e))detail='The Moodle network connection was interrupted. Your saved material is kept.';else if(/Executable doesn't exist|distribution.*not found/i.test(detail))detail='Microsoft Edge is required. Install or update Edge, then choose Open Moodle again.';else if(/timeout|timed out|fetch failed/i.test(detail))detail='The connection took too long. Check your internet and Moodle sign-in, then try again.';else if(/Target.*closed|browser.*closed/i.test(detail))detail='The Moodle window was closed. Open it again to continue.';this.update({stage:'error',continuationPending:false,title:'Let’s finish connecting.',detail:e.status===401?'This laptop connection expired. Connect your Neyvu account again.':detail,retry:this.state?'moodle':'pair'});}
 async pause(){this.currentFileAbort?.abort();this.resumeRequested=false;clearInterval(this.timer);clearInterval(this.identityTimer);await this.context?.close();this.context=null;this.page=null;}
}
