const element=id=>document.getElementById(id);
let running=false,lastStage=null,lastStatus=null,lastPhase=1,pendingFocus=null,courseReview=null;
let courseDraft=new Set(),courseDraftDirty=false,pendingAction=null,cancelPending=false,cancelRequested=false;
let operationStartedAt=null,lastObservedUpdate=null,lastUpdateSignature=null,checksSignature=null;

function setText(id,value){const node=element(id),text=value||'';if(node.textContent!==text)node.textContent=text;}
function timestamp(value){const time=value?new Date(value).getTime():NaN;return Number.isFinite(time)?time:null;}
function count(value){return Number.isSafeInteger(value)&&value>=0?value:null;}
function duration(milliseconds){const seconds=Math.max(0,Math.floor(milliseconds/1000));return seconds<60?seconds+' sec':Math.floor(seconds/60)+' min '+seconds%60+' sec';}
function selectionCount(){
 const selected=element('course-choice-list').querySelectorAll('input:checked').length;
 setText('course-selection-count',selected+' current '+(selected===1?'course':'courses')+' selected'+(selected>40?' · choose at most 40':''));
 const button=element('actions').querySelector('[data-action="select"]');
 if(button)button.disabled=running||!selected||selected>40;
}
function showError(message,retry=false){setText('action-error',message);element('action-error').hidden=!message;element('retry-status').hidden=!retry;}

function renderChoices(choices){
 const list=element('course-choice-list'),existing=new Map(Array.from(list.children).map(item=>[item.dataset.courseId,item]));
 const next=choices.map(course=>{
  let item=existing.get(course.id);
  if(!item){
   item=document.createElement('li');item.dataset.courseId=course.id;
   const label=document.createElement('label'),input=document.createElement('input'),text=document.createElement('span');
   input.type='checkbox';input.value=course.id;
   input.onchange=()=>{courseDraftDirty=true;if(input.checked)courseDraft.add(course.id);else courseDraft.delete(course.id);selectionCount();};
   label.append(input,text);item.append(label);
  }
  const input=item.querySelector('input'),text=item.querySelector('span');
  input.checked=courseDraft.has(course.id);input.disabled=running;
  if(text.textContent!==course.title)text.textContent=course.title;
  return item;
 });
 next.forEach((item,index)=>{if(list.children[index]!==item)list.insertBefore(item,list.children[index]||null);});
 Array.from(list.children).forEach(item=>{if(!next.includes(item))item.remove();});
}

function phaseFor(s){
 if(['welcome','pairing','checking','preflight','restore'].includes(s.stage))return 1;
 if(['moodle','resume','sign-in','confirm'].includes(s.stage))return 2;
 if(['courses','reading-courses'].includes(s.stage))return 3;
 if(['collecting','connected','paused'].includes(s.stage))return 4;
 return s.progress?4:s.account?Math.max(2,lastPhase):1;
}
function renderMetrics(progress){
 const items=[];
 if(count(progress?.pagesSaved)!==null)items.push(['Pages saved',progress.pagesSaved]);
 if(count(progress?.pagesAttempted)!==null)items.push(['Pages attempted',progress.pagesAttempted]);
 if(count(progress?.filesSaved)!==null)items.push(['Original files saved',progress.filesSaved]);
 if(count(progress?.pass)!==null)items.push(['Collection batch',progress.pass]);
 if(count(progress?.gaps)!==null)items.push(['Reading checks',progress.gaps]);
 const metrics=element('activity-metrics');metrics.hidden=!items.length;
 const signature=JSON.stringify(items);
 if(metrics.dataset.signature!==signature){
  metrics.dataset.signature=signature;
  metrics.replaceChildren(...items.map(([name,value])=>{const group=document.createElement('div'),term=document.createElement('dt'),data=document.createElement('dd');term.textContent=name;data.textContent=String(value);group.append(term,data);return group;}));
 }
}
function activityTiming(){
 if(element('activity').hidden)return;
 const busy=element('activity').dataset.busy==='true',now=Date.now(),progress=lastStatus?.progress;
 setText('activity-elapsed',busy&&operationStartedAt?'Elapsed '+duration(now-operationStartedAt):'');
 if(!lastStatus)return;
 const updated=timestamp(progress?.updatedAt)||lastObservedUpdate;
 const saved=timestamp(progress?.lastSavedAt);
 setText('activity-update',saved?'Last item saved at '+new Date(saved).toLocaleTimeString():updated?'Progress updated at '+new Date(updated).toLocaleTimeString():'Waiting for the first progress update.');
 const silentFor=updated?Math.max(0,now-updated):0;
 const waiting=busy&&lastStatus.stage!=='sign-in'&&silentFor>=45000;
 element('activity-wait').hidden=!waiting;
 if(waiting)setText('activity-wait','No new progress update for '+duration(silentFor)+'. Keep the Companion and Moodle window open.'+(lastStatus.stage==='collecting'?' You can pause collection below.':''));
}
function renderOriginals(s){
 const blocked=running||['checking','collecting','reading-courses'].includes(s.stage);
 element('review-originals').disabled=blocked;
 setText('retained-wait',blocked?(pendingAction==='export-original'?'Finish or cancel the Save dialog to continue. Your retained original is kept.':pendingAction==='originals'?'Reading retained PDFs on this computer…':s.stage==='collecting'?'Pause collection or wait for the current file to finish before recovering originals.':'Wait for the current setup step to finish before recovering originals.'):'');element('retained-wait').hidden=!blocked;
 element('review-originals').textContent=running&&pendingAction==='originals'?'Reviewing retained PDFs…':'Review retained PDFs';
 const data=s.retainedOriginals,rows=Array.isArray(data?.items)?data.items:[],list=element('retained-list');
 const states={original_retained:'Original retained; reading not finished',prepared:'Reading retained; upload not started',transfer_pending:'Transfer pending; saved progress is kept',receipt_saved:'Upload receipt saved'};
 const existing=new Map(Array.from(list.children).map(n=>[n.dataset.key,n]));
 const next=rows.map(row=>{
  let item=existing.get(row.key);
  if(!item){item=document.createElement('li');item.dataset.key=row.key;for(const tag of ['strong','p','p','p','p','button'])item.append(document.createElement(tag));}
  const [title,detail,state,coverage,digest,button]=item.children;
  title.textContent=row.title;detail.textContent=(row.course_title||'Moodle course '+row.course_id)+' · '+(row.account_label||'Moodle account '+row.identity_key)+' · '+Number(row.bytes).toLocaleString()+' bytes';
  const date=timestamp(row.captured_at);state.textContent=(states[row.state]||'Retained record')+(date?' · captured '+new Date(date).toLocaleString():'');digest.textContent='SHA-256 '+row.sha256;digest.className='retained-hash';
  const c=row.coverage;coverage.textContent=c?c.pages_accounted+' of '+c.physical_pages+' physical pages accounted for. '+c.pages_needing_review+' pages have extraction gaps or need review. Text observations are not verified understanding; compare equations, tables and diagrams with the original.':'Page coverage is not available yet. The original remains recoverable.';
  button.type='button';button.className='secondary';button.textContent='Save original copy…';button.disabled=blocked;button.onclick=()=>run('export-original',{key:row.key,recovery_handle:row.recovery_handle,sha256:row.sha256});return item;
 });
 next.forEach((item,index)=>{if(list.children[index]!==item)list.insertBefore(item,list.children[index]||null);});Array.from(list.children).forEach(item=>{if(!next.includes(item))item.remove();});
 if(data){const unreadable=Number.isSafeInteger(data.unreadable)?data.unreadable:0;element('retained-summary').dataset.warning=String(unreadable>0);setText('retained-summary',rows.length+' recoverable retained '+(rows.length===1?'PDF':'PDFs')+'.'+(unreadable?' '+unreadable+(unreadable===1?' record':' records')+' could not be opened. Use the same computer account and retry. Nothing was removed.':''));}
 setText('retained-message',s.retainedOriginalMessage);element('retained-message').hidden=!s.retainedOriginalMessage;
 setText('retained-error',s.retainedOriginalError);element('retained-error').hidden=!s.retainedOriginalError;
}
function renderActivity(s){
 const progress=s.progress,activeStages=['checking','pairing','sign-in','reading-courses','collecting'];
 const busy=!['connected','paused','error'].includes(s.stage)&&(running||activeStages.includes(s.stage));
 const show=busy||!!progress||s.stage==='paused'||s.stage==='error';
 element('activity').hidden=!show;
 element('activity').dataset.busy=String(busy);
 element('activity').dataset.outcome=s.stage;
 if(!show){operationStartedAt=null;return;}
 if(busy&&!operationStartedAt)operationStartedAt=Date.now();
 if(!busy)operationStartedAt=null;
 const actionLabels={pair:'Opening account sign-in',moodle:'Opening your Moodle window',check:'Checking Moodle identity',confirm:'Confirming your Moodle account',courses:'Reading the course list',select:'Saving your course selection',preflight:'Checking this laptop',reset:'Disconnecting this laptop',refresh:'Starting collection'};
 const phaseLabels={reading:'Reading visible Moodle pages',saving:'Saving visible course text',checking:'Checking saved-content readiness',indexing:'Document reading pending',complete:'Collection finished',cancelled:'Collection paused',paused:'Waiting for Moodle sign-in',retrying:'Retrying a temporary Moodle error',continuing:'Next collection batch starts shortly',partial:'Saved material needs a coverage check'};
 let heading=phaseLabels[progress?.phase]||actionLabels[pendingAction]||s.stage==='sign-in'&&'Waiting for Moodle sign-in'||s.stage==='reading-courses'&&'Reading the course list'||s.stage==='collecting'&&'Collecting visible Moodle pages'||'Connection status';
 if(s.stage==='paused')heading='Saved so far';
 if(s.stage==='error')heading='Connection needs attention';
 if(cancelRequested||progress?.cancelRequested)heading='Pausing after the current page';
 setText('activity-title',heading);
 const fallbackMessage=s.stage==='collecting'?(progress?'Only your confirmed current courses are being collected. Saved history stays in your vault.':s.title):s.stage==='paused'?'Retry continues reading your selected courses. Saved pages remain available.':s.stage==='reading-courses'?'The list is being read for your review. No course material is being imported.':s.detail;
 setText('activity-message',cancelRequested||progress?.cancelRequested?'Pause requested. The current navigation or save will finish safely; saved pages remain in your vault.':fallbackMessage);
 const course=typeof progress?.currentCourse==='string'?progress.currentCourse:progress?.currentCourse?.title;
 const index=count(progress?.index),total=count(progress?.total);
 const courseLabel=course?((index!==null&&total!==null?'Course '+index+' of '+total+': ':'')+course):'';
 element('activity-course').hidden=!courseLabel;setText('activity-course',courseLabel);
 const page=typeof progress?.currentPage==='string'?progress.currentPage:progress?.currentPage?.title;
 element('activity-page').hidden=!page;setText('activity-page',page?(['paused','connected','error'].includes(s.stage)?'Last reported page: ':'Current page: ')+page:'');
 renderMetrics(progress);activityTiming();
}
function renderCoverage(s){
 const courses=s.collectedCourses||[];element('course-coverage').hidden=!courses.length;
 setText('coverage-title',s.partialSaved?(s.stage==='paused'?'Pages saved before collection paused':'Pages saved before collection stopped'):'Saved course pages');
 setText('coverage-detail',s.partialSaved?'This collection stopped early. Saved pages remain available; retry to check the rest of your selected courses.':'Compare these selected courses with Moodle, including each separate lab. You can change future collection with Choose current courses.');
 const list=element('course-list'),signature=JSON.stringify(courses);
 if(list.dataset.signature!==signature){
  list.dataset.signature=signature;
  list.replaceChildren(...courses.map(course=>{const item=document.createElement('li'),name=document.createElement('strong'),detail=document.createElement('span');name.textContent=course.title;detail.textContent=course.pages+' visible pages saved'+(count(course.files)!==null?' · '+course.files+' original '+(course.files===1?'file':'files')+' saved':'')+(course.gaps?' · '+course.gaps+(course.gaps===1?' reading check':' reading checks'):'');item.append(name,detail);return item;}));
 }
 const listing=(s.listingIssues||[]).join(' ');setText('listing-issues',listing);element('listing-issues').hidden=!listing;
 const issues=s.collectionIssues||[];element('collection-gaps').hidden=!issues.length;
 setText('collection-gaps-title',issues.length+' '+(issues.length===1?'reading check':'reading checks'));
 const gapList=element('collection-gap-list'),gapSignature=JSON.stringify(issues);
 if(gapList.dataset.signature!==gapSignature){
  gapList.dataset.signature=gapSignature;
  gapList.replaceChildren(...issues.map(issue=>{const item=document.createElement('li'),name=document.createElement('strong'),reason=document.createElement('span');name.textContent=[issue.course,issue.title].filter(Boolean).join(' · ')||'Visible Moodle page';reason.textContent=(issue.code==='budget'?'Waiting for another pass. ':issue.code==='unsupported'?'Outside automatic collection. ':issue.code==='file_too_large'?'File too large. ':issue.code==='temporary'?'Read interrupted. ':'')+(issue.reason||'Check this item in Moodle before relying on the saved material.');item.append(name,reason);if(issue.action){const action=document.createElement('span');action.textContent=issue.action;item.append(action);}return item;}));
 }
}
function renderReadiness(readiness){
 const fields=[['Pages with readable text','totalReadablePages'],['Pages with only titles or links','totalTitleOnlyPages'],['Stored files','attachmentsStored'],['Files with readable text','attachmentsReadable'],['Files awaiting text','attachmentsPending'],['Files needing a check','attachmentsFailed']];
 const values=fields.filter(([,key])=>count(readiness?.[key])!==null);
 element('content-readiness').hidden=!values.length;
 const metrics=element('readiness-metrics'),signature=JSON.stringify(values.map(([name,key])=>[name,readiness[key]]));
 if(metrics.dataset.signature!==signature){
  metrics.dataset.signature=signature;
  metrics.replaceChildren(...values.map(([name,key])=>{const item=document.createElement('div'),term=document.createElement('dt'),data=document.createElement('dd');term.textContent=name;data.textContent=String(readiness[key]);item.append(term,data);return item;}));
 }
 const warnings=[];
 if(count(readiness?.attachmentsPending)>0)warnings.push(readiness.attachmentsPending+' stored '+(readiness.attachmentsPending===1?'file is':'files are')+' still waiting for readable text.');
 if(count(readiness?.attachmentsFailed)>0)warnings.push(readiness.attachmentsFailed+' '+(readiness.attachmentsFailed===1?'file needs':'files need')+' another check in Sources.');
 if(count(readiness?.totalTitleOnlyPages)>0)warnings.push('Some saved pages have only titles or links. Check the original material before relying on an answer.');
 setText('readiness-warning',warnings.join(' '));element('readiness-warning').hidden=!warnings.length;
 const limitations=Array.isArray(readiness?.limitations)?readiness.limitations.filter(value=>typeof value==='string'&&value):[];
 element('readiness-limitations').hidden=!limitations.length;
 const list=element('readiness-limitations'),limitSignature=JSON.stringify(limitations);
 if(list.dataset.signature!==limitSignature){list.dataset.signature=limitSignature;list.replaceChildren(...limitations.map(value=>{const item=document.createElement('li');item.textContent=value;return item;}));}
}
function render(s){
 document.body.dataset.stage=s.stage;
 const actions=element('actions'),active=document.activeElement;
 const focusedAction=actions.contains(active)?active.dataset.action:null;
 const restore=focusedAction?{action:focusedAction,stage:lastStage||s.stage}:active===document.body?pendingFocus:null;
 if(focusedAction&&!pendingFocus)pendingFocus=restore;
 const signature=JSON.stringify([s.stage,s.title,s.detail,s.progress]);
 if(signature!==lastUpdateSignature){lastObservedUpdate=Date.now();lastUpdateSignature=signature;}
 lastStatus=s;
 if(s.stage!=='collecting'){cancelRequested=false;cancelPending=false;}
 setText('diagnostic',s.diagnostics?JSON.stringify(s.diagnostics,null,2):'No identity diagnostic yet.');
 setText('title',s.stage==='collecting'?'Bringing your courses into the vault.':s.title);
 setText('detail',s.detail);
 setText('release','Companion for Acadia Moodle'+(s.release?' · '+s.release:''));
 const choices=s.courseChoices||[];element('course-selection').hidden=s.stage!=='courses';
 if(s.stage==='courses'){
  if(courseReview!==s.courseReview){courseReview=s.courseReview;courseDraft=new Set(choices.filter(course=>course.selected).map(course=>course.id));courseDraftDirty=false;}
  const filters={inprogress:'Moodle: In progress',all:'Moodle: All courses',allincludinghidden:'Moodle: All courses including hidden',past:'Moodle: Past courses',future:'Moodle: Future courses',favourites:'Moodle: Starred courses',unknown:'Visible list: current status unverified'};
  setText('course-filter',filters[s.courseFilter]||'Moodle course filter: '+(s.courseFilter||'unverified'));
  renderChoices(choices);
  element('course-selection-empty').hidden=!!choices.length;
  const issues=(s.listingIssues||[]).join(' ');setText('course-selection-issues',issues);element('course-selection-issues').hidden=!issues;
 }
 element('account').hidden=!s.account;setText('account',s.account?'Neyvu account: '+s.account:'');
 element('identity').hidden=!s.identity;setText('identity',s.identity?'Moodle account: '+s.identity:'');
 renderCoverage(s);renderReadiness(s.content_readiness);renderOriginals(s);
 const nextChecks=JSON.stringify(s.checks||[]);
 if(nextChecks!==checksSignature){
  checksSignature=nextChecks;
  element('checks').replaceChildren(...(s.checks||[]).map(check=>{const line=document.createElement('p');line.textContent=(check.state==='pass'?'✓ ':check.state==='fail'||check.state==='warn'?'! ':'○ ')+check.name+': '+check.detail;line.className='check-'+check.state;return line;}));
 }
 setText('eyebrow',s.stage==='error'?'Needs attention':s.stage==='connected'?'Saved to your vault':s.stage==='paused'?'Collection paused':s.stage==='collecting'?'Importing your selected courses':s.stage==='courses'?'Review before importing':'Connect your Moodle');
 element('reset').disabled=running||['checking','collecting','reading-courses'].includes(s.stage);element('retry-status').disabled=running;
 const checked=timestamp(s.lastCheck);setText('updated',checked?'Last refresh attempt: '+new Date(checked).toLocaleString()+(s.lastRefresh?.outcome==='partial'?' · Some material still needs review.':''):'');
 const nextRefresh=timestamp(s.nextRefreshAt),showNextRefresh=!!nextRefresh&&(s.stage==='connected'||s.stage==='error'&&s.retry==='refresh');
 element('next-refresh').hidden=!showNextRefresh;
 setText('next-refresh',showNextRefresh?(s.nextRefreshIsContinuation?'Next collection batch: ':'Next automatic refresh: ')+new Date(nextRefresh).toLocaleTimeString():'');
 const phase=phaseFor(s);lastPhase=phase;
 for(let index=1;index<=4;index++){const step=element('step'+index);step.className=index===phase?'active':index<phase?'done':'';if(index===phase)step.setAttribute('aria-current','step');else step.removeAttribute('aria-current');}
 const buttons=[];
 if(s.stage==='preflight')buttons.push(['preflight','Check setup again']);
 if(s.stage==='restore')buttons.push(['preflight','Check setup again'],['open','Open Neyvu']);
 if(['welcome','pairing'].includes(s.stage))buttons.push(['pair',s.stage==='pairing'?'Open sign-in again':'Connect Neyvu account']);
 if(['moodle','resume'].includes(s.stage))buttons.push(['moodle','Open Moodle']);
 if(s.stage==='sign-in')buttons.push(['check','Check Moodle account'],['moodle','Show Moodle window']);
 if(s.stage==='confirm')buttons.push(['confirm','Yes, connect this Moodle account'],['moodle','Show Moodle window']);
 if(s.stage==='courses')buttons.push(['select','Import selected courses'],['courses','Reload course list'],['moodle','Show Moodle window'],['open','Open Neyvu']);
 if(s.stage==='connected')buttons.push(['open','Open Neyvu'],...(s.continuationPending?[['cancel-refresh','Pause collection']]:[['refresh','Refresh selected courses'],['courses','Choose current courses']]));
 if(s.stage==='paused')buttons.push(['refresh','Retry selected courses'],['open','Open Neyvu'],['courses','Choose current courses']);
 if(s.stage==='collecting')buttons.push(['open','Open Neyvu'],['cancel-refresh',cancelRequested||s.progress?.cancelRequested?'Pausing collection…':'Pause collection']);
 if(s.stage==='reading-courses')buttons.push(['open','Open Neyvu']);
 if(s.stage==='error'){if(s.retry==='pair'||!s.account)buttons.push(['pair','Reconnect Neyvu']);else if(s.retry==='refresh')buttons.push(['refresh','Retry selected courses'],['moodle','Show Moodle window'],['open','Open Neyvu']);else buttons.push(['moodle','Open Moodle'],['check','Check Moodle account'],['courses','Choose current courses'],['pair','Reconnect Neyvu']);}
 const existing=new Map(Array.from(actions.children).map(button=>[button.dataset.action,button]));
 const next=buttons.map(([action,label],index)=>{
  const button=existing.get(action)||document.createElement('button');button.type='button';button.dataset.action=action;
  button.textContent=running&&pendingAction===action?({select:'Saving your selection…',courses:'Reading course list…',check:'Checking account…',preflight:'Checking setup…',moodle:'Opening Moodle…',refresh:'Starting collection…',pair:'Opening sign-in…',confirm:'Confirming account…'}[action]||label):label;
  button.className=index?'secondary':'';
  button.disabled=action==='cancel-refresh'?cancelPending||cancelRequested||!!s.progress?.cancelRequested:running&&action!=='open';
  button.onclick=()=>run(action);return button;
 });
 next.forEach((button,index)=>{if(actions.children[index]!==button)actions.insertBefore(button,actions.children[index]||null);});
 Array.from(actions.children).forEach(button=>{if(!next.includes(button))button.remove();});
 if(s.stage==='courses')selectionCount();
 renderActivity(s);
 if(!running){
  const target=restore&&(next.find(button=>button.dataset.action===restore.action)||(restore.stage!==s.stage?next[0]:null));
  if(target&&!target.disabled&&(document.activeElement===active||document.activeElement===document.body))target.focus({preventScroll:true});
  pendingFocus=null;
 }
 lastStage=s.stage;
}
async function pauseCollection(){
 if(cancelPending||cancelRequested||lastStatus?.progress?.cancelRequested)return;
 cancelPending=true;cancelRequested=true;showError('');if(lastStatus)render(lastStatus);
 try{render(await window.schoolvault.action('cancel-refresh'));}
 catch{cancelRequested=false;showError('Collection could not be paused. You can try Pause collection again; pages already saved remain in your vault.');}
 finally{cancelPending=false;if(lastStatus)render(lastStatus);}
}
async function run(action,explicitPayload){
 if(action==='open'){showError('');try{await window.schoolvault.action('open');}catch{showError('Neyvu could not open in your browser. Try Open Neyvu again. Collection can continue in this window.');}return;}
 if(action==='cancel-refresh')return pauseCollection();
 if(running)return;
 const active=document.activeElement;if(element('actions').contains(active))pendingFocus={action:active.dataset.action,stage:lastStage};
 running=true;pendingAction=action;operationStartedAt=Date.now();showError('');
 const payload=explicitPayload||(action==='select'||action==='courses'&&lastStatus?.stage==='courses'&&(courseDraft.size||courseDraftDirty)?{ids:[...courseDraft]}:undefined);
 if(lastStatus)render(lastStatus);else document.querySelectorAll('button').forEach(button=>button.disabled=true);
 let actionFailed=false,statusFailed=false;
 try{render(await window.schoolvault.action(action,payload));}catch{actionFailed=true;}
 finally{
  try{render(await window.schoolvault.status());}catch{statusFailed=true;}
  running=false;pendingAction=null;if(lastStatus)render(lastStatus);else element('retry-status').disabled=false;
  if(statusFailed)showError('Connection status could not be updated. Check status again; your saved connection has not been cleared.',true);
  else if(actionFailed)showError('This step could not finish. Try it again. Keep the Companion and Moodle window open.');
 }
}
async function checkStatus(){
 if(running)return;running=true;pendingAction='status';showError('');
 if(lastStatus)render(lastStatus);else{
  operationStartedAt=Date.now();document.querySelectorAll('button').forEach(button=>button.disabled=true);
  setText('title','Checking your connection.');setText('detail','Reading the saved laptop connection and setup status.');
  element('step1').className='active';element('step1').setAttribute('aria-current','step');
  element('activity').hidden=false;element('activity').dataset.busy='true';element('activity').dataset.outcome='checking';
  setText('activity-title','Checking saved connection');setText('activity-message','Waiting for the current connection status from this laptop.');
 }
 try{render(await window.schoolvault.status());}
 catch{showError('Connection status could not be checked. Try again, or close and reopen the Companion.',true);}
 finally{running=false;pendingAction=null;if(lastStatus)render(lastStatus);else{
  element('retry-status').disabled=false;element('activity').dataset.busy='false';
  setText('title','Check your connection status.');setText('detail','The current account and collection status could not be verified.');
  setText('activity-title','Connection status unavailable');setText('activity-message','Check connection status to try again. Your saved connection has not been cleared.');setText('activity-elapsed','');
 }}
}
window.schoolvault.onStatus(render);void checkStatus();
element('review-originals').onclick=()=>run('originals');
element('retry-status').onclick=()=>void checkStatus();
element('reset').onclick=()=>{if(confirm('Disconnect this laptop and clear its saved pairing and isolated Moodle browser sign-in? Your cloud notes and sources stay saved. Google will ask you to choose an account on reconnect.'))run('reset');};
setInterval(activityTiming,1000);
