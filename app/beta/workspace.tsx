'use client';
import FeedbackWorkspace from './feedback-workspace';
import GroupClarificationChips from './group-clarification-chips';
import type {GroupClarification} from '../../lib/beta/group-clarification';
import WorkspaceNavigation from './workspace-navigation';
import CourseworkSources from './coursework-sources';
import ActivityStatus from './activity-status';
import {usePresentation} from './use-presentation';
import AnswerBody,{matchesPlanningWorkTitle} from './answer-body';
import TodayAsk from './today-ask';
import SourcePanel from './source-panel';
import SourcePassage from './source-passage';
import BrowserCopyBoundary from './browser-copy-boundary';
import {useBrowserCopies} from './browser-copy-context';
import {chatScope,sameChatScope,scopeKey,pinnedScope,type ChatScope} from '../../lib/beta/chat-scope';
import {chatCreations,rememberChatCreation,forgetChatCreation,chatCreationSettled,creationScope,type ChatCreation} from '../../lib/beta/chat-creation';
import {browserDraftForWriter,browserDrafts,rememberBrowserDraft,forgetBrowserDraft,recoverBrowserDrafts,acknowledgeBrowserDraft,bindNewBrowserDraft,pendingQuestions,pendingSettled,rememberPendingQuestion,forgetPendingQuestion,matchesPendingReceipt,type PendingQuestion,type BrowserDraft,type RecoveryStorage} from '../../lib/beta/chat-recovery';
import {languageHref} from '../../lib/beta/language';
import {useI18n,LanguageSelect} from "./language";

import MoodleFreshness from './moodle-freshness';
import WorkspaceFind from './workspace-find';
import SourceLimitations from './source-limitations';
import {awaitingReadableVersion,adoptReadVersion,SOURCE_READ_POLL_MS,SOURCE_READ_POLL_LIMIT} from '../../lib/beta/source-refresh';
import SourceUpload from './source-upload';
import {useSourceLibrary} from './use-source-library';
import {courseLabel as displayCourseLabel} from '../../lib/beta/course-label';
import {PRODUCT_NAME,WORDMARK,WORDMARK_LIGHT,SYMBOL,SYMBOL_LIGHT} from '../../lib/brand';
import EvidenceChange from './evidence-change';
import {ProductHeading,EvidenceLabel} from './product-ui';
import WorkspaceState from './workspace-state';
import dynamic from 'next/dynamic';
import {useSearchParams} from 'next/navigation';
import {todayCoverageTarget} from '../../lib/beta/desktop';
function RecordingsLoading(){return <ActivityStatus label="Opening class recordings…"/>;}
const ClassRecordings=dynamic(()=>import('./class-recordings'),{ssr:false,loading:RecordingsLoading});
import StudentPlanner,{ProgressEditor,PlanEditor} from './student-planner';
import {workStatus} from '../../lib/beta/planning-view';
import Onboarding from './onboarding';
import GuidedSetup from './guided-setup';
import AssessmentClaims from './assessment-claims';
import {useAssessments} from './use-assessments';
import type {PlanningState} from '../../lib/beta/student-planning';
import MaterialReading,{type ReadingProgress} from './reading-progress';
import type {ChangedSource} from '../../lib/beta/source-dependencies';
import {sourceReferenceHref,findSourceReference} from '../../lib/beta/source-reference';
import {moodleActivityLink,quotedSourceExcerpt} from '../../lib/beta/source-focus';
import CourseContextPanel from './course-context';
import TimetableSuggestions from './timetable-suggestions';
import SourceGuide from './source-guide';
import MemoryManager from './memory-manager';
import WorkspaceSettings from './settings';
import {backgroundAnswer} from '../../lib/beta/background-answer';
import StudySessionPanel from './study-session';
import {useStudySession} from './use-study-session';
import {studyApproaches,studyRequest,studyResponse,type StudyApproach,type StudyRequestKind,type StudySession} from '../../lib/beta/study-session';
import SourceProfile from './source-profile';
import type {SourceContent} from '../../lib/beta/source-content';
import {createContext,useCallback,useContext,useEffect,useLayoutEffect,useState,useRef} from 'react';
import {BookOpen,MessageSquare,Plus,ArrowUp,Search,FileText,LogOut,CalendarDays,Menu,X,ArrowLeft,Upload,Bell,Settings,ChevronDown} from 'lucide-react';
import Appearance from './appearance';
import PilotReport from './pilot-report';
import AssistantFeedback,{assistantFeedbackState,WorkspaceOpening} from './assistant-feedback';
import AnswerActions from './answer-actions';
import AnswerRecovery from './answer-recovery';
import {isWithheldExample,sourceRecoveryFollowup} from '../../lib/beta/answer-disposition';
import {conversationScrollTarget} from '../../lib/beta/conversation-scroll';
import CourseReadinessPanel,{type Coverage} from './course-readiness';
import TodayCoverage from './today-coverage';
import MoodleConnection from './connection';
import LocalConnection from './local-connection';
import ScheduleForm from './schedule-form';
import BetaCalendar from './calendar';
import {acknowledgeSave} from '../../lib/beta/editor';
import MaterialUpdates,{type MaterialChange} from './material-updates';
import type {BetaMeeting,BetaTask} from '../../lib/beta/agenda';
import Markdown from 'react-markdown';
import remarkMath from 'remark-math';
import {studyCitations} from '../../lib/beta/study-citations';
import {pageFragment} from '../../lib/beta/connectors/citation-page';
import rehypeKatex from 'rehype-katex';
type Course={id:string;code:string;title:string};
type Note={id:string;course_id:string;source_id:string;title:string;body:string;version:number;origin?:string;changed_sources?:ChangedSource[]};
type Source={returned_feedback?:{format:number;version_id:string};content?:SourceContent;capture?:{captured_at:string;coverage:{scope:string;issues:string[]}};version_id?:string;object_key?:string;id:string;course_id:string;title:string;kind:string;original_url?:string;mime?:string;body?:string;excerpt?:string;observed_at?:string};
type MembershipReference={course_id:string;profile_url:string;observed_at:string;version:string};
const MessageSources=createContext<{sources:Source[];membership?:MembershipReference;open:(source:Source,trigger:HTMLElement)=>void}|null>(null);
function MessageSourceLink({href,children}:{href?:string;children?:React.ReactNode}){
 const context=useContext(MessageSources),membership=context?.membership;
 if(href==='#moodle-membership'&&membership&&/^https:\/\/moodle\.acadiau\.ca\/user\/view\.php\?id=[1-9]\d{0,11}&course=[1-9]\d{0,11}$/.test(membership.profile_url)
  &&/^[a-f0-9]{64}$/.test(membership.version)&&Number.isFinite(Date.parse(membership.observed_at))){
  return <a className="beta-inline-citation" href={membership.profile_url} target="_blank" rel="noreferrer" title={new Date(membership.observed_at).toLocaleString()}>{children}</a>;
 }
 const source=context?findSourceReference(context.sources,href):undefined;
 return source?<button className="beta-inline-citation" data-beta-source={source.id} data-beta-version={source.version_id} onClick={e=>{const quote=quotedSourceExcerpt(source.excerpt,e.currentTarget.closest('blockquote')?.innerText);context!.open(quote?{...source,excerpt:quote}:source,e.currentTarget);}}>{children}</button>:<span>{children}</span>;
}
const messageComponents={img:()=>null,a:MessageSourceLink};
type Chat={id:string;title:string;updated_at?:string;course_id:string|null;mode:string;draft:string;context:string[];context_versions?:Record<string,string>;archived:boolean};
type Message={id:string;role:string;content:{text:string;type?:string;job_id?:string;context_course_id?:string;moodle_membership?:MembershipReference;clarification?:GroupClarification};sources:Source[];changed_sources?:ChangedSource[]};
type Job={activity?:{label:string;source_title?:string;course?:string}|null;source_id?:string|null;source_title?:string|null;id:string;kind:'answer'|'extract';chat_id:string|null;status:string;error:string|null;question?:string|null;draft?:string|null;updated_at?:string|null;study_note_id?:string|null;study_note_skipped?:string|null};
type Connector={provider:string;identity:string|null;status:string;checked_at:string|null};
type Workspace={chat_creation_ids?:boolean;planning?:PlanningState;reading?:ReadingProgress;coverage:Coverage[];courses:Course[];notes:Note[];sources:Source[];changes:MaterialChange[];chats:Chat[];tasks:BetaTask[];meetings:BetaMeeting[];jobs:Job[];connectors:Connector[];assistant_ready:boolean;assistant?:'ready'|'offline'|'disabled'};
const extractionStatus:Record<string,string>={queued:'Waiting to read the document',leased:'Reading the document',complete:'Ready to search',failed:'Could not read this document'};
const empty:Workspace={coverage:[],courses:[],notes:[],sources:[],changes:[],chats:[],tasks:[],meetings:[],jobs:[],connectors:[],assistant_ready:false};
async function demoAction(op:string){const r=await fetch('/api/beta/demo',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({op}),signal:AbortSignal.timeout(30000)});const body=await r.json().catch(()=>({}));if(!r.ok)throw Error(body.error||'The demo account could not finish this. Try again.');return body;}
async function rawApi(op?:string,data?:unknown,signal?:AbortSignal){
 const r=await fetch(data?'/api/beta':'/api/beta'+(op?'?'+op:''),{method:data?'POST':'GET',credentials:'same-origin',headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
 const body=await r.json();if(!r.ok)throw Object.assign(Error(body.error||'Could not finish. Please try again.'),{status:r.status});return body;
}
type WorkspaceProps={actor:{id:string;name:string;email:string;timezone:string;demo?:boolean};local?:boolean;captureEnabled?:boolean};
export default function BetaWorkspace(props:WorkspaceProps){return <BrowserCopyBoundary key={props.actor.id} actor={props.actor.id}><WorkspaceContents {...props}/></BrowserCopyBoundary>;}
function WorkspaceContents({actor,local=false,captureEnabled=false}:WorkspaceProps){
 const browserCopies=useBrowserCopies();
 const {preferences:presentation}=usePresentation();
 async function api(op?:string,data?:unknown,signal?:AbortSignal){if(!browserCopies.canWrite())throw Error('Browser work is paused. Reopen saved account data before continuing.');const result=await rawApi(op,data,signal);if(!browserCopies.canWrite())throw Error('Browser work is paused. Reopen saved account data before continuing.');return result;}

 const {t:ui,locale,language}=useI18n();
 const [ws,setWs]=useState(empty),[tab,setTab]=useState('today'),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[nav,setNav]=useState(false);
 const searchParams=useSearchParams();
 const showTodayCoverage=tab==='today'&&!local&&!actor.demo&&searchParams.get('tab')==='today'&&searchParams.get('coverage')==='1';
 const guidedEntryChecked=useRef(false);
 const [todayQuestion,setTodayQuestion]=useState(''),[todayQuestionCourse,setTodayQuestionCourse]=useState('');
 const [loadFailed,setLoadFailed]=useState(false),[pendingSend,setPendingSend]=useState<{id:string;question:string;chat:string;language?:'en'|'es';scope?:ChatScope;base?:string}|null>(null);
 const pendingSendRef=useRef(pendingSend),settlementRead=useRef(0);pendingSendRef.current=pendingSend;
 const sendRecoveryError=useRef<string|null>(null);
 const [recoveringSend,setRecoveringSend]=useState(false);
 const [sendInFlight,setSendInFlight]=useState(false),[outgoing,setOutgoing]=useState<{question:string;chat:string|null}|null>(null);
 const [answerRefreshing,setAnswerRefreshing]=useState(false),[answerRefreshError,setAnswerRefreshError]=useState(''),[newResponse,setNewResponse]=useState(false);
 const [memoryTrigger,setMemoryTrigger]=useState<HTMLElement|null>(null),[accountOpen,setAccountOpen]=useState(false);
 const [completedAnswer,setCompletedAnswer]=useState<Job|null>(null);
 const observedAnswers=useRef(new Set<string>());
 const {session:study,sessions:studySessions,persistent:studyPersistent,update:updateStudy,select:selectStudy}=useStudySession(actor.id);
 const [studyOpen,setStudyOpen]=useState(false);
 const [studyMobileView,setStudyMobileView]=useState<'conversation'|'study'>('study');
 const conversationScroll=useRef<HTMLDivElement>(null),composerInput=useRef<HTMLTextAreaElement>(null),followLatest=useRef(true);
 const [readingAnswer,setReadingAnswer]=useState(false),[composerFocused,setComposerFocused]=useState(false);
 const lastReadScroll=useRef(0),wasCompactComposer=useRef(false),composerReveal=useRef<Animation|null>(null);
 const resetPageScroll=useRef(false),focusComposer=useRef(false);
 const pagingAnchor=useRef<{top:number;height:number}|null>(null);
 const workspaceRead=useRef(0),answerRead=useRef(0),answerRequest=useRef<{id:string;promise:Promise<void>}|null>(null);
 const [listLimit,setListLimit]=useState(100),[olderMessages,setOlderMessages]=useState(false);
 const listLimitRef=useRef(100);
 async function loadMore(){await run(async()=>{const next=Math.min(2000,listLimitRef.current+200);setWs(await api('limit='+next));listLimitRef.current=next;setListLimit(next);});}
 async function loadOlder(){if(!chat||!messages.length)return;await run(async()=>{const r=await api('op=chat&id='+chat.id+'&before='+messages[0].id);const scroller=conversationScroll.current;if(scroller){followLatest.current=false;pagingAnchor.current={top:scroller.scrollTop,height:scroller.scrollHeight};}setMessages(current=>[...r.messages,...current]);setOlderMessages(r.has_more);});}

 const [lastSeenUpdates,setLastSeenUpdates]=useState('');
 const [updatesRefreshing,setUpdatesRefreshing]=useState(false),[updatesError,setUpdatesError]=useState('');
 const updatesRead=useRef(0),tabRef=useRef(tab);tabRef.current=tab;
 const updatesKey='schoolvault-updates-v1:'+actor.id;
 const unseenUpdates=lastSeenUpdates?ws.changes.filter(change=>change.observed_at>lastSeenUpdates).length:0;
 const [pendingMode,setPendingMode]=useState('ask'),[pendingCourse,setPendingCourse]=useState('');
 const pendingSettings=useRef({mode:pendingMode,course_id:pendingCourse||null});pendingSettings.current={mode:pendingMode,course_id:pendingCourse||null};
 const dialog=useRef<HTMLDialogElement>(null);
 const [openingSource,setOpeningSource]=useState('');
 const [sourceWidth,setSourceWidth]=useState(440),[sourceExcerpt,setSourceExcerpt]=useState<string|undefined>();
 const sourceScroll=useRef<number|null>(null);
 const sourceTrigger=useRef<HTMLElement|null>(null),notebookCourse=useRef<HTMLSelectElement>(null),noteTitleInput=useRef<HTMLTextAreaElement>(null);
 const sourceFocus=useRef<{id:string;version:string;index:number;returnToLibrary:boolean}|null>(null);
 function restoreSourceFocus(){requestAnimationFrame(()=>{if(dialog.current?.open)return;if(sourceScroll.current!==null&&conversationScroll.current)conversationScroll.current.scrollTop=sourceScroll.current;sourceScroll.current=null;const saved=sourceFocus.current;if(saved?.returnToLibrary){const row=Array.from(sourceList.current?.querySelectorAll<HTMLElement>('[data-beta-source]')||[]).find(el=>el.dataset.betaSource===saved.id);(row||sourceSearchInput.current)?.focus();return;}if(sourceTrigger.current?.isConnected){sourceTrigger.current.focus({preventScroll:true});return;}const matches=saved?Array.from(document.querySelectorAll<HTMLElement>('[data-beta-source]')).filter(el=>el.dataset.betaSource===saved.id&&(el.dataset.betaVersion||'')===saved.version):[];(matches[saved?.index||0]||matches[0]||document.getElementById('beta-main'))?.focus();});}
 const navPanel=useRef<HTMLElement>(null),navTrigger=useRef<HTMLButtonElement>(null),mainPanel=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(!nav)return;
  const panel=navPanel.current,main=mainPanel.current;
  if(!panel||!main)return;
  const previous=document.activeElement instanceof HTMLElement?document.activeElement:navTrigger.current;
  const oldOverflow=document.body.style.overflow;
  main.inert=true;document.body.style.overflow='hidden';
  const controls=()=>Array.from(panel.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),[tabindex="0"]')).filter(el=>el.getClientRects().length);
  panel.querySelector<HTMLElement>('.beta-nav-close')?.focus();
  const keys=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();setNav(false);return;}
   if(event.key!=='Tab')return;
   const items=controls(),first=items[0],last=items[items.length-1];
   if(!first)return;
   if(event.shiftKey&&(document.activeElement===first||!panel.contains(document.activeElement))){event.preventDefault();last.focus();}
   else if(!event.shiftKey&&(document.activeElement===last||!panel.contains(document.activeElement))){event.preventDefault();first.focus();}
  };
  const desktop=window.matchMedia('(min-width:701px)'),resize=()=>{if(desktop.matches)setNav(false);};
  document.addEventListener('keydown',keys);desktop.addEventListener('change',resize);resize();
  return()=>{main.inert=false;document.body.style.overflow=oldOverflow;document.removeEventListener('keydown',keys);desktop.removeEventListener('change',resize);if(previous?.isConnected)previous.focus();};
 },[nav]);
 const draftSave=useRef<Promise<unknown>>(Promise.resolve());
 const creatingChat=useRef<Promise<Chat>|null>(null);
 const [chatCreating,setChatCreating]=useState(false);
 const creationIntent=useRef<ChatCreation|null>(null);const [creationRecovery,setCreationRecovery]=useState<ChatCreation[]>([]);
 const [savedDraft,setSavedDraft]=useState('');
 const serverDrafts=useRef(new Map<string,string>()),serverScopes=useRef(new Map<string,ChatScope>()),draftWriter=useRef('');
 const [draftRecovery,setDraftRecovery]=useState<BrowserDraft[]>([]),[draftLocal,setDraftLocal]=useState(true),[draftSaveError,setDraftSaveError]=useState<'failed'|'conflict'|null>(null);
 function storage(kind:'localStorage'|'sessionStorage'='localStorage'):RecoveryStorage|null{if(!browserCopies.canWrite())return null;try{return window[kind];}catch{return null;}}
 function stores(){return [storage(),storage('sessionStorage')];}
 function writer(){return draftWriter.current||(draftWriter.current=crypto.randomUUID());}
 function pendingQuestion(id?:string){const requests=pendingQuestions(stores(),actor.id);return requests.find(r=>r.chat===id)||requests[0]||null;}
 function scopeFor(saved:Chat|null=chatRef.current,changes:Partial<Chat>={}):ChatScope{
  const base=saved||{...pendingSettings.current,context:[],context_versions:{}};
  return chatScope({...base,...changes,...(changes.context!==undefined&&changes.context_versions===undefined?{context_versions:{}}:{})});
 }
 function retainDraft(value:string,chatId=chatRef.current?.id||null,base=savedDraftRef.current,desired=scopeFor()){
  const local=storage(),own=browserDraftForWriter(local,actor.id,chatId,writer()),baseScope=chatId?serverScopes.current.get(chatId)||desired:desired;
  if(value===base&&sameChatScope(desired,baseScope)){if(own)forgetBrowserDraft(local,actor.id,own);setDraftLocal(true);return true;}
  const kept=rememberBrowserDraft(local,actor.id,{...desired,schema:2,chat:chatId,writer:writer(),revision:crypto.randomUUID(),text:value,base,base_scope:baseScope,...(!chatId&&(own?.creation_id||creationIntent.current?.id)?{creation_id:own?.creation_id||creationIntent.current!.id,creation_initial:own?.creation_initial||creationIntent.current!.initial}:{})});setDraftLocal(kept);return kept;
 }
 function editDraft(value:string){if(draftRecovery.length)return;draftRef.current=value;setDraft(value);setDraftSaveError(null);retainDraft(value);}
 function editPending(changes:{mode?:string;course_id?:string|null}){pendingSettings.current={...pendingSettings.current,...changes};if(changes.mode)setPendingMode(changes.mode);if(changes.course_id!==undefined)setPendingCourse(changes.course_id||'');retainDraft(draftRef.current);}
 function applyChatDraft(saved:Chat|null,value:string){
  chatRef.current=saved;setChat(saved);const base=saved?.draft||'';if(saved){serverDrafts.current.set(saved.id,base);serverScopes.current.set(saved.id,scopeFor(saved));}
  savedDraftRef.current=base;setSavedDraft(base);draftRef.current=value;setDraft(value);setDraftSaveError(null);
 }
 function adoptDraft(saved:Chat|null,courses=ws.courses){
  const base=saved?.draft||'',savedScope=saved?scopeFor(saved):undefined;applyChatDraft(saved,base);setDraftLocal(true);
  const records=browserDrafts(storage(),actor.id,saved?.id||null);for(const r of records.filter(r=>savedScope&&r.base_scope!==null&&r.text===base&&sameChatScope(r,savedScope)))forgetBrowserDraft(storage(),actor.id,r);
  let recovered=recoverBrowserDrafts(records,base,pendingQuestions(stores(),actor.id).filter(q=>q.chat===saved?.id).map(q=>q.question),savedScope);if(recovered.restore&&!saved&&recovered.restore.course_id&&!courses.some(c=>c.id===recovered.restore!.course_id))recovered={restore:null,choices:records};setDraftRecovery(recovered.choices);
  if(recovered.restore){
   const record=recovered.restore;if(!saved){const creation=chatCreations(stores(),actor.id).find(r=>r.id===record.creation_id||r.writer===record.writer)||(record.creation_id&&record.creation_initial?{schema:1 as const,id:record.creation_id,writer:record.writer,kind:'first' as const,initial:record.creation_initial}:null);if(creation){const own={...creation,writer:writer()};if(!chatCreationSettled(stores(),actor.id,own.id)&&!rememberChatCreation([storage()],actor.id,own))throw Error('This browser could not keep the conversation recovery ID. Your question is kept.');creationIntent.current=own;}pendingSettings.current={mode:record.mode,course_id:record.course_id};setPendingMode(pendingSettings.current.mode);setPendingCourse(pendingSettings.current.course_id||'');}
   draftRef.current=record.text;setDraft(record.text);
   const desired=saved?scopeFor(record as unknown as Chat):scopeFor(null);
   if(retainDraft(record.text,saved?.id||null,base,desired))for(const r of records.filter(r=>r.text===record.text&&sameChatScope(r,record)))forgetBrowserDraft(storage(),actor.id,r);
   setNotice('Recovered your unsent question with its saved course and source selection.');
  }
  return recovered.choices.length;
 }
 async function chooseDraft(choice:BrowserDraft|null,textOnly=false){
  const records=[...draftRecovery],saved=chatRef.current;
  await run(async()=>{
   if(!choice){
    if(saved){const latest=await api('op=chat&id='+encodeURIComponent(saved.id));if(latest.chat.draft!==savedDraftRef.current||!sameChatScope(scopeFor(latest.chat),serverScopes.current.get(saved.id)!)){adoptDraft(latest.chat);setNotice('The saved version changed again. Review the current drafts.');return;}applyChatDraft(latest.chat,latest.chat.draft);}
    for(const r of records)forgetBrowserDraft(storage(),actor.id,r);setDraftRecovery([]);setNotice('The saved draft is kept.');return;
   }
   draftWriter.current=crypto.randomUUID();
   const desired=textOnly||choice.base_scope===null?scopeFor(saved):chatScope(choice);
   if(!saved){const creation=chatCreations(stores(),actor.id).find(r=>r.id===choice.creation_id||r.writer===choice.writer)||(choice.creation_id&&choice.creation_initial?{schema:1 as const,id:choice.creation_id,writer:choice.writer,kind:'first' as const,initial:choice.creation_initial}:null);if(creation){const own={...creation,writer:writer()};if(!chatCreationSettled(stores(),actor.id,own.id)&&!rememberChatCreation([storage()],actor.id,own))throw Error('This browser could not keep the conversation recovery ID. Your question is kept.');creationIntent.current=own;}}
   if(!saved){pendingSettings.current={mode:desired.mode,course_id:desired.course_id};setPendingMode(desired.mode);setPendingCourse(desired.course_id||'');}
   const kept=retainDraft(choice.text,saved?.id||null,savedDraftRef.current,desired);
   if(saved||!kept){if(!saved){draftRef.current=choice.text;setDraft(choice.text);}const target=saved||await ensureChat();const updated=await persistChanges(target.id,{...desired,draft:choice.text});applyChatDraft(updated,updated.draft);}
   else{draftRef.current=choice.text;setDraft(choice.text);}
   // Clear only the exact alternatives the student saw, after a durable copy.
   for(const r of records)forgetBrowserDraft(storage(),actor.id,r);setDraftRecovery([]);
   setNotice(choice.base_scope===null?'Text recovered with the saved source selection. Review those sources before sending.':'Device draft and its course/source versions selected. Review before sending.');
  });
 }
 function persistChanges(id:string,changes:Partial<Chat>){
  const current=chatRef.current?.id===id?chatRef.current:null,expected=serverScopes.current.get(id)||scopeFor(current),desired=scopeFor(current||({...expected,draft:''} as Chat),changes);
  if(changes.draft!==undefined&&current)retainDraft(changes.draft,id,serverDrafts.current.get(id)||'',desired);
  const next=draftSave.current.catch(()=>{}).then(async()=>{const base=serverDrafts.current.get(id),result=await api('',{op:'chat.update',id,changes:{...changes,...(changes.draft!==undefined?{...desired,expected_draft:base??'',expected_context:expected}:{})}});
   const scope=scopeFor(result);serverDrafts.current.set(id,result.draft);serverScopes.current.set(id,scope);
   if(changes.draft!==undefined)acknowledgeBrowserDraft(storage(),actor.id,id,writer(),base??'',result.draft,scope);
   if(chatRef.current?.id===id){chatRef.current=result;setChat(result);savedDraftRef.current=result.draft;setSavedDraft(result.draft);setDraftSaveError(null);if(draftRef.current===result.draft)setDraftLocal(true);}return result;
  }).catch(error=>{if(chatRef.current?.id===id)setDraftSaveError(error.status===409?'conflict':'failed');throw error;});draftSave.current=next;return next;
 }
 function persistDraft(id:string,value:string){return persistChanges(id,{draft:value});}
 async function retryDraft(){await run(async()=>{const c=await ensureChat();await persistDraft(c.id,draftRef.current);setError('');});}
 async function reloadDraft(){await run(async()=>{if(chatRef.current){const result=await api('op=chat&id='+encodeURIComponent(chatRef.current.id));adoptDraft(result.chat);}setError('');});}
 const [chat,setChat]=useState<Chat|null>(null),[messages,setMessages]=useState<Message[]>([]),[draft,setDraft]=useState(''),[note,setNote]=useState<Note|null>(null),[dirty,setDirty]=useState(false);
 const chatRef=useRef(chat),draftRef=useRef(draft),savedDraftRef=useRef(savedDraft),dirtyRef=useRef(dirty),busyRef=useRef(busy);
 chatRef.current=chat;draftRef.current=draft;savedDraftRef.current=savedDraft;dirtyRef.current=dirty;busyRef.current=busy;
 const navigationGeneration=useRef(0),historyPending=useRef(false),currentAddress=useRef(''),historyDraftChats=useRef(new Map<string,string>());
 const [course,setCourse]=useState(''),[courseCode,setCourseCode]=useState(''),[courseTitle,setCourseTitle]=useState(''),[addingCourse,setAddingCourse]=useState(false),[query,setQuery]=useState(''),[searchedQuery,setSearchedQuery]=useState<string|null>(null),[source,setSource]=useState<Source|null>(null),[now,setNow]=useState<Date|null>(null);
 const [plannerDirty,setPlannerDirty]=useState(false);
 const deskPlanDirty=useRef(false),deskDirtyKeys=useRef(new Map<string,boolean>());
 const [answerPlan,setAnswerPlan]=useState<{message:string;plan:string}|null>(null);
 const [deskSelection,setDeskSelection]=useState<{chat:string;task:string;suggestion:string}|null>(null);
 const [deskCollapsed,setDeskCollapsed]=useState(false);
 const deskPlanButton=useRef<HTMLElement|null>(null),deskPlanHeading=useRef<HTMLHeadingElement>(null);
 const deskPlanFocus=useRef(false),todaySend=useRef<{chat:string;question:string}|null>(null);
 const reportDeskDirty=useCallback((key:string,dirty:boolean)=>{if(dirty)deskDirtyKeys.current.set(key,true);else deskDirtyKeys.current.delete(key);deskPlanDirty.current=deskDirtyKeys.current.size>0;},[]);
 function canLeaveDesk(){if(!deskPlanDirty.current)return true;setError('Save or reload your assignment plan before switching conversations. Your edit is kept.');return false;}

 const assessmentRead=useAssessments((tab==='today'||tab==='sources')&&!loading&&!!ws.planning,(ws.sources[0]?.version_id||'')+':'+ws.sources.length+':'+(ws.planning?.plans.map(p=>p.id+p.revision).join(',')||''));
 const [plannerTask,setPlannerTask]=useState<{id:string;kind?:'task'|'plan';request:number}|undefined>();
 const [captureActive,setCaptureActive]=useState(false),[captureVisited,setCaptureVisited]=useState(false);const captureActiveRef=useRef(false);captureActiveRef.current=captureActive;
 useEffect(()=>{if(tab==='classes')setCaptureVisited(true);},[tab]);
 const [scheduleDirty,setScheduleDirty]=useState(false),[scheduleCourse,setScheduleCourse]=useState('');
 useEffect(()=>{if(tab!=='calendar')setScheduleCourse('');},[tab]);
 const scheduleDirtyRef=useRef(false);scheduleDirtyRef.current=scheduleDirty;
 const scheduleAddress=useRef(''),scheduleSaving=useRef(false),openScheduleReview=useRef(false);
 useEffect(()=>{if(scheduleDirty)scheduleAddress.current=window.location.pathname+window.location.search;},[scheduleDirty]);
 const [setupFiles,setSetupFiles]=useState(false);
 const [uploadActive,setUploadActive]=useState(false);
 const [readableCopy,setReadableCopy]=useState<{course:string}>();
 const [importOpen,setImportOpen]=useState(false);
 useEffect(()=>{if(uploadActive||(!loading&&!ws.sources.length))setImportOpen(true);},[uploadActive,loading,ws.sources.length]);

 const [noteQuery,setNoteQuery]=useState('');
 const sourceSearchInput=useRef<HTMLInputElement>(null),importDisclosure=useRef<HTMLDetailsElement>(null);
 function clearSourceSearch(){setQuery('');setSearchedQuery(null);library.reload();sourceSearchInput.current?.focus();}
 function showImport(){setSourceView('all');setImportOpen(true);requestAnimationFrame(()=>{importDisclosure.current?.scrollIntoView({block:'nearest'});importDisclosure.current?.querySelector('summary')?.focus();});}
 const noteRef=useRef<Note|null>(null);noteRef.current=note;
 const [noteConflict,setNoteConflict]=useState<Note|null>(null);
 function editNote(field:'title'|'body',value:string){if(!noteRef.current)return;const next={...noteRef.current,[field]:value};noteRef.current=next;dirtyRef.current=true;setNote(next);setDirty(true);}
 async function refresh(){const generation=++workspaceRead.current;const next=await api('limit='+listLimitRef.current);if(generation===workspaceRead.current){setWs(next);setLoadFailed(false);}return next;}
 async function refreshAnswer(){
  const id=chatRef.current?.id;if(!id){await refresh();return;}
  if(answerRequest.current?.id===id)return answerRequest.current.promise;
  const generation=++answerRead.current,navigation=navigationGeneration.current,workspaceGeneration=++workspaceRead.current;
  const isCurrent=()=>generation===answerRead.current&&navigation===navigationGeneration.current&&chatRef.current?.id===id;
  const promise=(async()=>{try{const result=await api('op=answer.progress&chat='+encodeURIComponent(id));if(!isCurrent())return;
   if(workspaceGeneration===workspaceRead.current)setWs(current=>{
    const known=current.jobs.find(job=>job.id===result.job?.id);
    // A poll started before stream completion can arrive after it.
    if(known&&!['queued','leased'].includes(known.status)&&['queued','leased'].includes(result.job.status))return current;
    return {...current,assistant:result.assistant,assistant_ready:result.assistant==='ready',jobs:result.job?[result.job,...current.jobs.filter(job=>job.id!==result.job.id)]:current.jobs};
   });
   if(result.messages!==null){setMessages(result.messages);setOlderMessages(result.has_more===true);if(result.job?.study_note_id)void refresh().catch(()=>{});}setAnswerRefreshError('');
  }catch(e){if(isCurrent())setAnswerRefreshError('Status could not refresh. Your saved question is kept here. Check status again for the latest answer.');throw e;}})();
  answerRequest.current={id,promise};
  try{await promise;}finally{if(answerRequest.current?.promise===promise)answerRequest.current=null;}
 }
 function acceptSavedRequest(pending:PendingQuestion,result:any){
  if(!matchesPendingReceipt(pending,result))return false;
  if(result.receipt.context_refused){
   const scope=pending.scope||scopeFor(result.chat);
   setDraftLocal(rememberBrowserDraft(storage(),actor.id,{...scope,schema:2,chat:pending.chat,writer:crypto.randomUUID(),revision:crypto.randomUUID(),text:pending.question,base:pending.base??'',base_scope:pending.scope||null}));
  }else for(const r of browserDrafts(storage(),actor.id,pending.chat).filter(r=>r.text===pending.question&&pending.scope&&sameChatScope(r,pending.scope)))forgetBrowserDraft(storage(),actor.id,r);
  forgetPendingQuestion(stores(),actor.id,pending);setPendingSend(pendingQuestion(chatRef.current?.id));
  setOutgoing(current=>current?.chat===pending.chat&&current.question===pending.question?null:current);
  if(chatRef.current?.id===pending.chat){
   adoptDraft(result.chat);setMessages(result.messages);setOlderMessages(result.has_more===true);
   setWs(current=>({...current,assistant:result.assistant,assistant_ready:result.assistant==='ready',chats:current.chats.map(c=>c.id===result.chat.id?result.chat:c),jobs:[result.job,...current.jobs.filter(j=>j.id!==result.job.id)]}));
   setError(current=>current===sendRecoveryError.current?'':current);
   if(result.receipt.context_refused){setStudyOpen(false);if(study?.chatId===pending.chat&&study.request?.question===pending.question)updateStudy(current=>({...current,request:null}));setNotice(result.receipt.message);}
   setAnswerRefreshError('');
   // Another window may have sent a newer question after this request finished.
   void refreshAnswer().catch(()=>{});
  }
  return true;
 }
 useEffect(()=>{
  if(loading||sendInFlight||!pendingSend)return;
  const pending=pendingSend,controller=new AbortController();let active=true,running=false,attempt=0;
  const check=async()=>{
   if(!active||running)return;
   if(busyRef.current||document.visibilityState!=='visible'||!navigator.onLine){clearTimeout(timer);timer=setTimeout(check,15000);return;}
   clearTimeout(timer);running=true;setRecoveringSend(true);const navigation=navigationGeneration.current;
   try{
    const result=await api('op=answer.progress&chat='+encodeURIComponent(pending.chat)+'&request='+encodeURIComponent(pending.id),undefined,controller.signal);
    if(!active||navigation!==navigationGeneration.current||pendingSendRef.current?.id!==pending.id||busyRef.current)return;
    acceptSavedRequest(pending,result);
   }catch{/* Keep the same pending ID through outages; never automatically POST. */}
   finally{running=false;if(active){setRecoveringSend(false);timer=setTimeout(check,Math.min(15000,3000*++attempt));}}
  };
  let timer:ReturnType<typeof setTimeout>;void check();
  const visible=()=>{if(document.visibilityState==='visible')void check();};
  window.addEventListener('online',check);document.addEventListener('visibilitychange',visible);
  return()=>{active=false;controller.abort();clearTimeout(timer);setRecoveringSend(false);window.removeEventListener('online',check);document.removeEventListener('visibilitychange',visible);};
 },[loading,sendInFlight,pendingSend?.id,chat?.id]);
 async function checkAnswerStatus(){if(answerRefreshing)return;setAnswerRefreshing(true);setAnswerRefreshError('');try{await refreshAnswer();}catch{setAnswerRefreshError('Status could not refresh. Your saved question is kept here. Check your internet connection and try again.');}finally{setAnswerRefreshing(false);}}
 async function retryLoad(){setLoading(true);try{await refresh();setError('');}catch(e){setLoadFailed(true);setError(e.message);}finally{setLoading(false);}}

 function startCreation(kind:'first'|'new',initial:ChatCreation['initial']){
  if(ws.chat_creation_ids!==true)throw Error('This server needs the conversation recovery update before creating a chat. Your question is kept.');
  const old=(creationIntent.current&&(kind==='first'||creationIntent.current.kind===kind)?creationIntent.current:null)||(chatCreations(stores(),actor.id).find(r=>r.writer===writer()&&r.kind===kind));if(old)return old;
  const ownDraft=browserDraftForWriter(storage(),actor.id,null,writer());
  const record:ChatCreation={schema:1,id:kind==='first'&&ownDraft?.creation_id||crypto.randomUUID(),writer:writer(),kind,initial:kind==='first'&&ownDraft?.creation_initial||initial};
  if(chatCreationSettled(stores(),actor.id,record.id)){creationIntent.current=record;return record;}
  if(!rememberChatCreation([storage()],actor.id,record))throw Error('This browser could not keep the conversation recovery ID. Your question is kept.');creationIntent.current=record;rememberChatCreation([storage('sessionStorage')],actor.id,record);
  if(kind==='first'&&!rememberBrowserDraft(storage(),actor.id,{...creationScope(record),schema:2,chat:null,writer:writer(),revision:crypto.randomUUID(),text:draftRef.current,base:ownDraft?.base||'',base_scope:ownDraft?.base_scope||creationScope(record),creation_id:record.id,creation_initial:record.initial}))throw Error('This browser could not keep the conversation recovery ID. Your question is kept.');
  setCreationRecovery(chatCreations(stores(),actor.id));return record;
 }
 async function finishCreation(record:ChatCreation,updateAddress=true){
  const generation=navigationGeneration.current,previous=chatRef.current?.id||null;
  const c=chatCreationSettled(stores(),actor.id,record.id)?{id:record.id}:await api('',{op:'chat.create',request_id:record.id,initial:record.initial});if(c.id!==record.id)throw Error('The server did not confirm the conversation recovery ID. Keep this question and update the server before retrying.');
  const view=await api('op=chat&id='+encodeURIComponent(c.id)),saved=view.chat as Chat;
  // The initial draft, not a possibly changed later draft, is the known base.
  const localDraft=browserDraftForWriter(storage(),actor.id,null,record.writer);
  if(localDraft&&!bindNewBrowserDraft(storage(),actor.id,record.writer,saved.id,record.initial.draft,localDraft.text,creationScope(record)))throw Error('This browser could not bind the question to its saved conversation. Check the interrupted conversation again.');
  if(generation!==navigationGeneration.current||(chatRef.current?.id||null)!==previous)return saved;
  const choices=adoptDraft(saved);setMessages(view.messages);setOlderMessages(view.has_more===true);if(updateAddress)chatAddress(saved.id);
  forgetChatCreation(stores(),actor.id,record);if(creationIntent.current?.id===record.id)creationIntent.current=null;setCreationRecovery(chatCreations(stores(),actor.id));
  if(choices)throw Error('Choose which draft to keep before continuing.');setWs(current=>({...current,chats:[saved,...current.chats.filter(c=>c.id!==saved.id)]}));return saved;
 }
 async function ensureChat(updateAddress=true){
  if(chatRef.current)return chatRef.current;
  if(!creatingChat.current){setChatCreating(true);creatingChat.current=(async()=>{const record=startCreation('first',{...pendingSettings.current,draft:draftRef.current});return finishCreation(record,updateAddress);})().finally(()=>{creatingChat.current=null;setChatCreating(false);setCreationRecovery(chatCreations(stores(),actor.id));});}return creatingChat.current;
 }
 async function checkCreation(record:ChatCreation){if(draftRecovery.length||!canLeaveDesk()||!canLeaveCalendar('chat'))return;await run(async()=>{if(chatRef.current)await persistDraft(chatRef.current.id,draftRef.current);else if(draftRef.current.trim()&&record.writer!==writer())throw Error('Save or recover your current question before opening another conversation.');setChatCreating(true);try{await finishCreation(record);go('chat',record.id,true);}finally{setChatCreating(false);setCreationRecovery(chatCreations(stores(),actor.id));}});}
 useEffect(()=>{setCreationRecovery(chatCreations(stores(),actor.id));const changed=(event:StorageEvent)=>{if(event.key?.startsWith('neyvu-chat-create-v1:'+encodeURIComponent(actor.id)+':')||event.key?.startsWith('neyvu-chat-created-v1:'+encodeURIComponent(actor.id)+':'))setCreationRecovery(chatCreations(stores(),actor.id));};window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed);},[]);
 useEffect(()=>{if(loading||busy||pendingSend||draftRecovery.length||draft===savedDraft||!chat&&!draft.trim())return;const t=setTimeout(()=>{ensureChat().then(c=>{if(chatRef.current?.id===c.id&&draftRef.current===draft&&!busyRef.current&&!pendingQuestion(c.id))return persistDraft(c.id,draft);}).catch(e=>{setDraftSaveError(e.status===409?'conflict':'failed');setError(e.message);});},650);return()=>clearTimeout(t);},[chat?.id,draft,savedDraft,busy,loading,pendingSend?.id,pendingMode,pendingCourse,draftRecovery.length]);
 useEffect(()=>{currentAddress.current=window.location.pathname+window.location.search;const initialView=new URL(window.location.href).searchParams.get('tab')||(new URL(window.location.href).searchParams.has('chat')?'chat':'today');if(['chat','today','notes','sources','calendar','connection','updates','settings',...(!local&&!actor.demo?['setup']:[]),...(captureEnabled?['classes']:[])].includes(initialView||''))setTab(initialView!);let active=true;api().then(async w=>{if(active)setWs(w);const params=new URL(window.location.href).searchParams;const view=params.get('tab');if(['chat','today','notes','sources','calendar','connection','updates','settings',...(!local&&!actor.demo?['setup']:[]),...(captureEnabled?['classes']:[])].includes(view||''))setTab(view!);setCourse(params.get('course')||'');const savedNote=params.get('note');if(savedNote){const n=await api('op=note&id='+encodeURIComponent(savedNote));if(active){noteRef.current=n;setNote(n);}}const savedSource=params.get('source');if(savedSource){const s=await api('op=source&id='+encodeURIComponent(savedSource)+(params.get('version')?'&version='+encodeURIComponent(params.get('version')!):''));if(active)setSource(s);}setPendingSend(pendingQuestion(params.get('chat')||undefined));const saved=params.get('chat');if(saved){const result=await api('op=chat&id='+encodeURIComponent(saved));if(active){adoptDraft(result.chat,w.courses);setMessages(result.messages);setOlderMessages(result.has_more===true);}}else if(active)adoptDraft(null,w.courses);}).catch(e=>{if(active){setError(e.message);setLoadFailed(true);}}).finally(()=>{if(active)setLoading(false);});setNow(new Date());const t=setInterval(()=>setNow(new Date()),30000);return()=>{active=false;clearInterval(t);navigationGeneration.current++;};},[]);
 useEffect(()=>{const changed=async(event:StorageEvent)=>{
 const sending=event.key?.startsWith('neyvu-chat-send-v1:'+encodeURIComponent(actor.id)+':')||event.key==='schoolvault-send-v1:'+actor.id,settled=event.key?.startsWith('neyvu-chat-settled-v1:'+encodeURIComponent(actor.id)+':');
  if(!sending&&!settled)return;
  const id=chatRef.current?.id,generation=navigationGeneration.current,readGeneration=++settlementRead.current,answerGeneration=answerRead.current,base=savedDraftRef.current,scope=id?serverScopes.current.get(id):null,known=pendingSendRef.current;
  setPendingSend(pendingQuestion(id)||(known&&!pendingSettled(stores(),actor.id,known.id)?known:null));
  if(known&&pendingSettled(stores(),actor.id,known.id))setOutgoing(null);
  if(!settled||!id||!scope||busyRef.current||draftRef.current!==base)return;
  try{const view=await api('op=chat&id='+encodeURIComponent(id));if(chatRef.current?.id===id&&generation===navigationGeneration.current&&readGeneration===settlementRead.current&&answerGeneration===answerRead.current&&!busyRef.current&&savedDraftRef.current===base&&draftRef.current===base&&sameChatScope(serverScopes.current.get(id)!,scope)){
   adoptDraft(view.chat);const incoming=new Set(view.messages.map((m:Message)=>m.id));setMessages(current=>[...current.filter(m=>!incoming.has(m.id)),...view.messages]);setOlderMessages(previous=>previous||view.has_more===true);
  }}catch{/* A failed cross-window refresh leaves the current draft intact. */}
 };window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed);},[actor.id]);
 useEffect(()=>{try{const saved=window.localStorage.getItem(updatesKey);if(saved&&Number.isFinite(Date.parse(saved)))setLastSeenUpdates(saved);else{const initial=new Date().toISOString();window.localStorage.setItem(updatesKey,initial);setLastSeenUpdates(initial);}}catch{}},[updatesKey]);
 useEffect(()=>{if(tab!=='updates'||!ws.changes.length)return;const latest=ws.changes[0].observed_at;if(lastSeenUpdates&&latest<=lastSeenUpdates)return;setLastSeenUpdates(latest);try{window.localStorage.setItem(updatesKey,latest);}catch{}},[tab,ws.changes,lastSeenUpdates,updatesKey]);
 async function refreshUpdates(isCurrent:()=>boolean=()=>tabRef.current==='updates'){
  const generation=++updatesRead.current;setUpdatesRefreshing(true);setUpdatesError('');
  try{const next=await api('limit='+listLimitRef.current);if(isCurrent()&&generation===updatesRead.current)setWs(next);}
  catch{if(isCurrent()&&generation===updatesRead.current)setUpdatesError('Updates could not refresh. Your saved versions are still shown. Check your connection and choose Refresh updates again.');}
  finally{if(isCurrent()&&generation===updatesRead.current)setUpdatesRefreshing(false);}
 }
 useEffect(()=>{if(tab!=='updates')return;let current=true;void refreshUpdates(()=>current);return()=>{current=false;updatesRead.current++;setUpdatesRefreshing(false);};},[tab]);
 useEffect(()=>{const check=()=>{if(document.visibilityState==='visible')refresh().catch(()=>{});};window.addEventListener('focus',check);const timer=setInterval(check,300000);return()=>{window.removeEventListener('focus',check);clearInterval(timer);};},[]);
 useEffect(()=>{if(!dirty&&!plannerDirty&&draft===savedDraft)return;const stop=(e:BeforeUnloadEvent)=>{e.preventDefault();};window.addEventListener('beforeunload',stop);return()=>window.removeEventListener('beforeunload',stop);},[dirty,plannerDirty,draft,savedDraft]);
 const answerStreamReady=useRef(false);
 const latestAnswer=ws.jobs.find(j=>j.kind==='answer'&&j.chat_id===chat?.id);
 const streamingJobId=latestAnswer&&['queued','leased'].includes(latestAnswer.status)?latestAnswer.id:null;
 useEffect(()=>{
  if(!chat||!streamingJobId||typeof EventSource==='undefined')return;
  const id=chat.id,jobId=streamingJobId;let active=true,stream:EventSource|null=null;
  const close=()=>{answerStreamReady.current=false;stream?.close();stream=null;};
  const connect=()=>{
   close();if(!active||document.visibilityState==='hidden')return;
   const connection=new EventSource('/api/beta?op=answer.stream&chat='+encodeURIComponent(id));
   stream=connection;
   connection.onopen=()=>{if(active&&stream===connection)answerStreamReady.current=true;};
   connection.onerror=()=>{if(stream===connection)answerStreamReady.current=false;};
   connection.onmessage=event=>{
    if(!active||stream!==connection||chatRef.current?.id!==id)return;
    try{const result=JSON.parse(event.data);
     if(result.job&&result.job.id!==jobId){close();void refreshAnswer().catch(()=>{});return;}
     setWs(current=>({...current,assistant:result.assistant,assistant_ready:result.assistant==='ready',jobs:result.job?[result.job,...current.jobs.filter(job=>job.id!==result.job.id)]:current.jobs}));
     if(Array.isArray(result.messages)){setMessages(result.messages);setOlderMessages(result.has_more===true);}
     setAnswerRefreshError('');if(!result.job||!['queued','leased'].includes(result.job.status))close();
    }catch{close();}
   };
  };
  const visibility=()=>document.visibilityState==='hidden'?close():connect();connect();document.addEventListener('visibilitychange',visibility);
  return()=>{active=false;close();document.removeEventListener('visibilitychange',visibility);};
 },[chat?.id,streamingJobId]);
 useEffect(()=>{const latest=ws.jobs.find(j=>j.kind==='answer'&&j.chat_id===chat?.id);if(!latest||!['queued','leased'].includes(latest.status)||!chat)return;let current=true;const id=chat.id;const t=setInterval(()=>{if(document.visibilityState!=='visible'||answerStreamReady.current)return;refreshAnswer().catch(()=>{if(current&&chatRef.current?.id===id)setAnswerRefreshError('Status could not refresh. Your saved question is kept here.');});},latest.status==='leased'?1000:ws.assistant==='ready'?2000:15000);return()=>{current=false;clearInterval(t);};},[chat?.id,ws.assistant,ws.jobs.map(j=>j.id+':'+j.status).join(',')]);
 useEffect(()=>{
  if((!showTodayCoverage&&!['sources','connection'].includes(tab))||!(ws.coverage.some(c=>(c.readiness?.attachments.pending||0)>0)||ws.jobs.some(j=>j.kind==='extract'&&['queued','leased'].includes(j.status))||!!ws.reading?.enabled&&!ws.reading.blocked_reason&&['not_started','queued','reading'].some(key=>ws.reading!.counts[key]>0)))return;
  let active=true,pending=false;
  const check=async()=>{
   if(pending||document.visibilityState!=='visible')return;
   pending=true;
   try{if(active)await refresh();}catch{}finally{pending=false;}
  };
  const timer=setInterval(check,ws.assistant==='ready'?5000:15000);
  return()=>{active=false;clearInterval(timer);};
 },[tab,showTodayCoverage,ws.assistant,ws.reading?.enabled,ws.reading?.blocked_reason,ws.reading?.counts.not_started,ws.reading?.counts.queued,ws.reading?.counts.reading,ws.coverage.map(c=>c.course_id+':'+c.readiness?.attachments.pending).join(','),ws.jobs.map(j=>j.id+':'+j.status).join(',')]);
 async function run(fn:()=>Promise<void>){if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'Could not finish. Try again.');}finally{busyRef.current=false;setBusy(false);}}
 function chatAddress(id:string){const u=new URL(window.location.href);u.searchParams.set('chat',id);window.history.replaceState(null,'',u.pathname+u.search);currentAddress.current=u.pathname+u.search;}
 function workspaceHref(next:string,chatId?:string|null){const p=new URLSearchParams({tab:next});if(next==='notes'){if(course)p.set('course',course);if(note)p.set('note',note.id);}const selectedChat=chatId===undefined?chat?.id:chatId;if(next==='chat'&&selectedChat)p.set('chat',selectedChat);return languageHref('/beta?'+p,language);}
 function canLeaveCalendar(next:string){if(next==='signout'&&!canLeaveDesk())return false;if(next==='signout'&&captureActiveRef.current){setError('Finish recording, save transcript corrections or download the audio recovery copy before signing out.');return false;}if(next==='calendar')return true;if(scheduleSaving.current){setError('Wait for your class schedule to finish saving before leaving Calendar.');return false;}return !scheduleDirtyRef.current||window.confirm(ui('Discard this unsaved class schedule and leave Calendar?'));}
 function go(next:string,chatId?:string|null,departureChecked=false){if(historyPending.current)return false;if(next!==tab&&!canLeaveDesk())return false;if(!departureChecked&&!canLeaveCalendar(next))return false;navigationGeneration.current++;dialog.current?.close();if(next!==tab)resetPageScroll.current=true;setTab(next);setNav(false);setAccountOpen(false);setMemoryTrigger(null);setStudyOpen(false);setSource(null);if(next==='calendar'&&tab==='calendar')return true;const address=workspaceHref(next,chatId);window.history.pushState(null,'',address);currentAddress.current=address;return true;}
 function ordinaryClick(e:React.MouseEvent<HTMLAnchorElement>){return !e.metaKey&&!e.ctrlKey&&!e.shiftKey&&!e.altKey&&e.button===0;}
 useEffect(()=>{
  const back=async()=>{
   let address=window.location.pathname+window.location.search;const p=new URL(window.location.href).searchParams,requested=p.get('tab'),next=requested==='setup'&&(local||actor.demo)?'today':requested||(p.has('chat')?'chat':'today'),noteId=p.get('note');
   const restoreAddress=()=>window.history.pushState(null,'',currentAddress.current);
   if(busyRef.current&&!historyPending.current){restoreAddress();setError('Wait for the current action to finish before using Back or Forward.');return;}
   const current=new URL(currentAddress.current,window.location.origin).searchParams;
   if((next!=='chat'||p.get('chat')!==current.get('chat'))&&!canLeaveDesk()){restoreAddress();return;}
   if(!canLeaveCalendar(next)){restoreAddress();return;}
   if(next==='notes'&&dirtyRef.current&&noteId!==noteRef.current?.id){restoreAddress();setError('Save your current note before opening another one. Your edits are preserved.');return;}
   const generation=++navigationGeneration.current,previousChat=chatRef.current,previousDraft=draftRef.current,previousAddress=currentAddress.current;
   historyPending.current=true;setBusy(true);setError('');setNotice('Opening saved view…');
   try{
    // Save the current draft before reading a history destination, including a first draft.
    if(previousChat||previousDraft.trim()){
     const saved=previousChat||await ensureChat(false);
     if(!previousChat)historyDraftChats.current.set(previousAddress,saved.id);
     if(previousDraft!==savedDraftRef.current)await persistDraft(saved.id,previousDraft);else await draftSave.current;
    }
    if(generation!==navigationGeneration.current)return;
    // An already-running first-draft save may have added its chat ID to the URL.
    window.history.replaceState(null,'',address);
    const sourceId=p.get('source'),chatId=p.get('chat')||(next==='chat'?historyDraftChats.current.get(address):null);
    if(chatId&&!p.get('chat')){p.set('chat',chatId);address=window.location.pathname+'?'+p;window.history.replaceState(null,'',address);}
    const [restoredNote,restoredSource,restoredChat]=await Promise.all([
     next==='notes'&&noteId&&!(dirtyRef.current&&noteRef.current?.id===noteId)?api('op=note&id='+encodeURIComponent(noteId)):Promise.resolve(null),
     sourceId?api('op=source&id='+encodeURIComponent(sourceId)+(p.get('version')?'&version='+encodeURIComponent(p.get('version')!):'')):Promise.resolve(null),
     chatId?api('op=chat&id='+encodeURIComponent(chatId)):Promise.resolve(null)
    ]);
    if(generation!==navigationGeneration.current)return;
    if(next==='notes'&&dirtyRef.current&&noteId!==noteRef.current?.id){restoreAddress();setError('Save your current note before opening another one. Your edits are preserved.');setNotice('');return;}
    if(!sourceId&&dialog.current?.open){dialog.current.close();restoreSourceFocus();}
    setSource(restoredSource);setAccountOpen(false);setMemoryTrigger(null);setStudyOpen(false);setTab(next);setCourse(p.get('course')||'');setNav(false);
    if(next==='notes'&&!dirtyRef.current){noteRef.current=restoredNote;setNote(restoredNote);setNoteConflict(null);setDirty(false);}
    if(restoredChat){adoptDraft(restoredChat.chat);setMessages(restoredChat.messages);setOlderMessages(restoredChat.has_more===true);}
    else if(next==='chat'){adoptDraft(null);setMessages([]);setOlderMessages(false);}
    currentAddress.current=address;setNotice('');
   }catch(e){if(generation===navigationGeneration.current){restoreAddress();setError(e instanceof Error?e.message:'This saved view could not open. Your current edits are preserved.');setNotice('');}}
   finally{if(generation===navigationGeneration.current){historyPending.current=false;setBusy(false);}}
  };
  window.addEventListener('popstate',back);return()=>window.removeEventListener('popstate',back);
 },[]);
 async function newChat({courseId=null,question='',task,sendNow=false}:{courseId?:string|null;question?:string;task?:BetaTask;sendNow?:boolean}={}){
  if(draftRecovery.length){setError('Choose which draft to keep before opening another conversation.');return false;}
  if(!canLeaveDesk()||!canLeaveCalendar('chat'))return false;
  let opened=false;
  await run(async()=>{
   if(chatRef.current||draftRef.current.trim()){const previous=await ensureChat();await persistDraft(previous.id,draftRef.current);}
   if(!task&&!question&&!creationIntent.current&&!chatCreations(stores(),actor.id).some(record=>record.writer===writer())){
    applyChatDraft(null,'');setMessages([]);setOlderMessages(false);setDraftRecovery([]);
    pendingSettings.current={mode:'ask',course_id:courseId};setPendingMode('ask');setPendingCourse(courseId||'');
    setDeskSelection(null);setDeskCollapsed(false);followLatest.current=true;focusComposer.current=true;
    go('chat',null,true);opened=true;return;
   }
   const initial:ChatCreation['initial']={mode:'ask',course_id:courseId,draft:question};
   if(task){
    const version=typeof task.evidence?.version_id==='string'?task.evidence.version_id:ws.sources.find(source=>source.id===task.source_id)?.version_id;
    if(!version)throw Error('No saved instructions version is available for this assignment.');
    initial.context=[task.source_id];initial.context_versions={[task.source_id]:version};
   }
   const record=startCreation('new',initial);
   if(record.initial.draft!==initial.draft||!sameChatScope(creationScope(record),creationScope({...record,initial})))throw Error('Check your interrupted conversation before opening another one. Your current question is kept.');
   setChatCreating(true);
   try{
    const saved=await finishCreation(record,false);
    if(chatRef.current?.id!==saved.id)return;
    setPendingMode('ask');setPendingCourse(courseId||'');setDeskSelection(null);setDeskCollapsed(false);
    focusComposer.current=true;
    if(sendNow&&saved.draft===question&&sameChatScope(scopeFor(saved),creationScope(record)))todaySend.current={chat:saved.id,question};
    go('chat',saved.id,true);opened=true;
   }finally{setChatCreating(false);setCreationRecovery(chatCreations(stores(),actor.id));}
  });
  return opened;
 }
 async function openChat(id:string){
  if(draftRecovery.length){setError('Choose which draft to keep before opening another conversation.');return false;}
  if(!canLeaveDesk()||!canLeaveCalendar('chat'))return false;
  if(busyRef.current||historyPending.current)return false;
  if(chatRef.current?.id===id){go('chat',id,true);return true;}
  let opened=false;
  await run(async()=>{
   if(chatRef.current||draftRef.current.trim()){const previous=await ensureChat();await persistDraft(previous.id,draftRef.current);}
   const result=await api('op=chat&id='+encodeURIComponent(id));
   adoptDraft(result.chat);setMessages(result.messages);setOlderMessages(result.has_more===true);
   setDeskSelection(null);setDeskCollapsed(false);go('chat',result.chat.id,true);opened=true;
  });
  return opened;
 }
 // After a group clarification choice, ask the same saved question again; the
 // new answer receives the student-reported group through the course context.
 async function reaskAfterGroup(message:Message){const index=messages.findIndex(m=>m.id===message.id),question=[...messages.slice(0,index)].reverse().find(m=>m.role==='user')?.content.text;if(!question){setNotice('Your group was saved. Ask your question again to use it.');return;}await send(question);}
 async function settings(changes:Partial<Chat>){if(!chat||draftRecovery.length||((changes.context!==undefined||changes.course_id!==undefined)&&!canLeaveDesk()))return;await run(async()=>{setChat(await persistChanges(chat.id,{...changes,draft:draftRef.current}));await refresh();});}
 async function send(questionOverride?:string,recoverRequest=false){const question=questionOverride||draftRef.current;if(busyRef.current||draftRecovery.length||!question.trim())return;if(!recoverRequest&&chatRef.current&&!pinnedScope(scopeFor())){setError('Select exact saved versions for your sources before sending this question.');return;}answerRead.current++;workspaceRead.current++;let uncertain=false,confirmedUser:string|null=null;const previousIds=new Set(messages.map(m=>m.id));followLatest.current=true;setNewResponse(false);setOutgoing({question,chat:chatRef.current?.id||null});setSendInFlight(true);setAnswerRefreshError('');try{await run(async()=>{try{const c=await ensureChat();setOutgoing({question,chat:c.id});await draftSave.current.catch(()=>{});
  let pending=pendingQuestion(c.id)||(pendingSend&&!pendingSettled(stores(),actor.id,pendingSend.id)?pendingSend:null);
  if(recoverRequest&&!pending){setPendingSend(null);const latest=await api('op=chat&id='+c.id);adoptDraft(latest.chat);setMessages(latest.messages);setNotice('This saved request was already checked in another window.');return;}
  if(pending&&(pending.chat!==c.id||pending.question!==question))throw Error('A previous send needs checking. Use Retry saved request first.');
  pending=pending||{id:crypto.randomUUID(),question,chat:c.id,language,scope:serverScopes.current.get(c.id)||scopeFor(c),base:serverDrafts.current.get(c.id)??c.draft};if(!rememberPendingQuestion(stores(),actor.id,pending))setDraftLocal(false);setPendingSend(pending);uncertain=true;
  const result=await api('',{op:'chat.send',id:c!.id,request_id:pending.id,question,response_language:pending.language||'en',expected_context:pending.scope,expected_draft:pending.base,recovery_only:!pending.scope});
  if(result.context_refused){
   const scope=pending.scope||scopeFor(c),local=rememberBrowserDraft(storage(),actor.id,{...scope,schema:2,chat:c.id,writer:crypto.randomUUID(),revision:crypto.randomUUID(),text:pending.question,base:pending.base??savedDraftRef.current,base_scope:pending.scope||null});setDraftLocal(local);
   forgetPendingQuestion(stores(),actor.id,pending);setPendingSend(pendingQuestion(c.id));uncertain=false;setOutgoing(null);setStudyOpen(false);if(study?.chatId===c.id&&study.request?.question===pending.question)updateStudy(current=>({...current,request:null}));
   const latest=await api('op=chat&id='+c.id);adoptDraft(latest.chat);setNotice(result.message);
  }else if(result.available===false){setNotice(result.message);serverDrafts.current.set(c.id,question);savedDraftRef.current=question;setSavedDraft(question);acknowledgeBrowserDraft(storage(),actor.id,c.id,writer(),question,question,serverScopes.current.get(c.id));setOutgoing(null);}else{const saved=await api('op=answer.progress&chat='+encodeURIComponent(c.id)+'&request='+encodeURIComponent(pending.id));if(!acceptSavedRequest(pending,saved))throw Error('The saved request could not yet be confirmed. Your question is kept.');confirmedUser=saved.messages.find((m:Message)=>m.role==='user'&&m.content.text===question&&!previousIds.has(m.id))?.id||null;}forgetPendingQuestion(stores(),actor.id,pending);setPendingSend(pendingQuestion(c.id));uncertain=false;
 }catch(e){if(uncertain)sendRecoveryError.current=e instanceof Error?e.message:'Could not finish. Try again.';throw e;}
 });}finally{if(!uncertain)setOutgoing(null);setSendInFlight(false);}return confirmedUser;}
 useEffect(()=>{
  const next=todaySend.current;
  if(!next||busy||chatCreating||tab!=='chat'||chat?.id!==next.chat)return;
  todaySend.current=null;
  if(!pendingSend&&draftRef.current===next.question)void send(next.question);
 },[busy,chatCreating,tab,chat?.id,pendingSend]);

 async function savePlanning(input:unknown){
  const row=await api('',input);
  const op=(input as {op?:string}).op;
  setNotice(op==='planning.scope.save'?'Your planning courses were saved.':op==='progress.save'?'Your personal progress was saved.':'Your plan was saved.');
  try{await refresh();}catch{setError('Your plan was saved. Reload to refresh Today and Calendar.');}
  return row;
 }

 async function selectNote(n:Note){if(busy)return;if(dirty){setError('Save your current note before opening another one.');return;}noteRef.current={...n};setNote({...n});setDirty(false);setNoteConflict(null);if(window.matchMedia('(max-width:700px)').matches)requestAnimationFrame(()=>noteTitleInput.current?.scrollIntoView({block:'start'}));const u=new URL(window.location.href);u.searchParams.set('note',n.id);window.history.replaceState(null,'',u.pathname+u.search);currentAddress.current=u.pathname+u.search;}
 function chooseNotebookCourse(id:string){
  if(dirty&&noteRef.current&&id&&noteRef.current.course_id!==id){setError('Save your current note before changing courses.');return;}
  setCourse(id);setNoteQuery('');setError('');
  const u=new URL(window.location.href);if(id)u.searchParams.set('course',id);else u.searchParams.delete('course');
  if(id&&noteRef.current?.course_id!==id){noteRef.current=null;setNote(null);setNoteConflict(null);u.searchParams.delete('note');}
  window.history.replaceState(null,'',u.pathname+u.search);
  currentAddress.current=u.pathname+u.search;
 }
 async function saveNote(){if(!noteRef.current)return;const submitted={...noteRef.current};await run(async()=>{try{const saved=await api('',{op:'note.update',id:submitted.id,version:submitted.version,title:submitted.title,body:submitted.body});if(noteRef.current?.id===submitted.id){const result=acknowledgeSave(noteRef.current,submitted,saved);noteRef.current=result.draft;dirtyRef.current=result.dirty;setNote(result.draft);setDirty(result.dirty);setNotice(result.dirty?'Earlier revision saved. Your newer edits still need saving.':'Note saved.');setNoteConflict(null);}}catch(e){if((e as {status?:number}).status===409){const latest=await api('limit='+listLimitRef.current);setWs(latest);setNoteConflict(await api('op=note&id='+submitted.id));}throw e;}try{await refresh();}catch{setError('Your note was saved. The note list could not refresh; reload Neyvu to update the list.'+(dirtyRef.current?' Your newer edits still need saving.':''));}});}
 async function preserveConflictCopy(){if(!noteRef.current)return;const submitted={...noteRef.current};await run(async()=>{const copy=await api('',{op:'note.create',course_id:submitted.course_id,title:(submitted.title+' · recovered draft').slice(0,180),body:submitted.body});const result=acknowledgeSave(noteRef.current||submitted,submitted,copy);noteRef.current=result.draft;dirtyRef.current=result.dirty;setNote(result.draft);setDirty(result.dirty);setNoteConflict(null);const u=new URL(window.location.href);u.searchParams.set('note',copy.id);window.history.replaceState(null,'',u.pathname+u.search);currentAddress.current=u.pathname+u.search;setNotice(result.dirty?'Recovery copy saved. Your newer edits still need saving.':'Your draft was saved as a separate note. The other version is preserved.');try{await refresh();}catch{setError('Your recovery copy was saved. The note list could not refresh; reload your vault before creating another copy.'+(dirtyRef.current?' Your newer edits still need saving.':''));}});}
 const [requestedRecording,setRequestedRecording]=useState<{id:string;ms:number;nonce:string}|null>(null);
 function openClassAction(id:string,ms:number){if(captureActiveRef.current){setError('Finish recording or save transcript corrections before opening class action evidence.');return;}setRequestedRecording({id,ms,nonce:crypto.randomUUID()});go('classes');}
 async function openCornellNote(id:string){if(dirtyRef.current){setError('Save your current note before opening the Cornell draft. Your edits are kept.');return;}if(!canLeaveCalendar('notes'))return;const generation=navigationGeneration.current;await run(async()=>{const n=await api('op=note&id='+encodeURIComponent(id));if(generation!==navigationGeneration.current||dirtyRef.current)return;noteRef.current=n;setNote(n);setCourse(n.course_id);setNoteQuery('');setDirty(false);setNoteConflict(null);go('notes',undefined,true);const address=new URL(window.location.href);address.searchParams.set('note',n.id);address.searchParams.set('course',n.course_id);window.history.replaceState(null,'',address.pathname+address.search);currentAddress.current=address.pathname+address.search;});}
 async function addNote(template:'blank'|'prep'|'review'='blank'){if(dirty){setError('Save your current note first.');return;}if(!course){setError('Choose a course for your new note.');notebookCourse.current?.focus();return;}await run(async()=>{const n=await api('',{op:'note.create',course_id:course,title:ui(template==='prep'?'Class preparation':template==='review'?'Reading review':'Class notes'),body:template==='blank'?'':(template==='prep'?['Personal preparation · check every claim against the source.','Assigned sources and exact pages / slides','Main argument and supporting reasons','Examples and distinctions','Connections to this course','Questions to raise in class','Live comments and instructor corrections','After-class review']:['Personal reading review · separate quotations from your interpretation.','Source title, saved version and pages / slides','What is the author arguing?','Evidence, examples and important distinctions','Limits, objections and unanswered questions','How does this connect to class and the assignment?','Explain it from memory, then check the source','Corrections and next study action']).map(text=>ui(text)).join('\n\n')});noteRef.current=n;setNote(n);setDirty(false);setNoteConflict(null);setNoteQuery('');requestAnimationFrame(()=>noteTitleInput.current?.focus());const u=new URL(window.location.href);u.searchParams.set('note',n.id);window.history.replaceState(null,'',u.pathname+u.search);currentAddress.current=u.pathname+u.search;try{await refresh();}catch{setError('Your new note was created. The note list could not refresh; reload it before creating another note.');}});}
 async function openSource(s:Source,trigger?:HTMLElement,returnToLibrary=false){if(busy)return;if(tab==='chat'&&!source)sourceScroll.current=conversationScroll.current?.scrollTop??null;sourceTrigger.current=trigger||(document.activeElement instanceof HTMLElement?document.activeElement:null);const matching=Array.from(document.querySelectorAll<HTMLElement>('[data-beta-source]')).filter(el=>el.dataset.betaSource===s.id&&(el.dataset.betaVersion||'')===(s.version_id||''));sourceFocus.current={id:s.id,version:s.version_id||'',index:Math.max(0,matching.indexOf(sourceTrigger.current!)),returnToLibrary};await run(async()=>{setOpeningSource(s.title||ws.sources.find(item=>item.id===s.id)?.title||'Saved source');try{const next=await api('op=source&id='+s.id+(s.version_id?'&version='+s.version_id:''));setSourceExcerpt(s.excerpt);setSource(next);const u=new URL(window.location.href);u.searchParams.set('source',s.id);if(s.version_id)u.searchParams.set('version',s.version_id);else u.searchParams.delete('version');window.history.pushState(null,'',u.pathname+u.search);currentAddress.current=u.pathname+u.search;}finally{setOpeningSource('');}});}
 function closeSource(){const u=new URL(historyPending.current?currentAddress.current:window.location.href,window.location.origin);if(historyPending.current){navigationGeneration.current++;historyPending.current=false;setBusy(false);setNotice('');}dialog.current?.close();setSource(null);u.searchParams.delete('source');u.searchParams.delete('version');window.history.replaceState(null,'',u.pathname+u.search);currentAddress.current=u.pathname+u.search;restoreSourceFocus();}
 function searchSources(){setSourceView('all');setSearchedQuery(query.trim()||null);library.reload();}
 useEffect(()=>{
  // An upload opened before the worker read it: pick up the text version when it lands.
  if(!awaitingReadableVersion(source))return;
  const opened=source!;let stopped=false,tries=0,pending=false;
  const timer=setInterval(async()=>{
   if(stopped||pending||document.visibilityState!=='visible')return;
   if(++tries>SOURCE_READ_POLL_LIMIT){clearInterval(timer);return;}
   pending=true;
   try{
    const latest=await api('op=source&id='+opened.id);
    if(stopped||!adoptReadVersion(opened,latest))return;
    clearInterval(timer);
    setSource(current=>current&&current.id===opened.id&&current.version_id===opened.version_id?latest:current);
    const u=new URL(window.location.href);
    if(!historyPending.current&&u.searchParams.get('source')===opened.id&&u.searchParams.get('version')===opened.version_id){u.searchParams.set('version',latest.version_id);window.history.replaceState(null,'',u.pathname+u.search);currentAddress.current=u.pathname+u.search;}
   }catch{}finally{pending=false;}
  },SOURCE_READ_POLL_MS);
  return()=>{stopped=true;clearInterval(timer);};
 },[source?.id,source?.version_id,source?.content?.state]);
 async function useInChat(s:Source,prompt?:string){if(draftRecovery.length)throw Error('Choose which draft to keep before opening another conversation.');if(prompt&&draft.trim())throw Error('Your current question is kept. Finish it or clear it before preparing a source review.');if(!canLeaveDesk()||!canLeaveCalendar('chat'))return;if(dirty)throw Error('Save your newer note edits before using this note in chat.');const c=await ensureChat();setChat(await persistChanges(c.id,{course_id:s.course_id,context:[s.id],context_versions:s.version_id?{[s.id]:s.version_id}:{},draft:prompt||draftRef.current}));if(prompt){setDraft(prompt);setSavedDraft(prompt);}focusComposer.current=true;go('chat',c.id,true);setNotice(prompt?'Source review question prepared. Review it, then send when ready.':'This source is selected for your next question.');}
 async function resetDemo(){if(!window.confirm(ui('Reset the demo account? Everyone using the demo code gets fresh sample data, and other open demo sessions end.')))return;await run(async()=>{await demoAction('reset');window.location.assign('/beta');});}
 const courseLabel=(id:string)=>displayCourseLabel(ws.courses.find(c=>c.id===id));
 const offline=ws.assistant==='offline';
 const currentJob=ws.jobs.find(job=>job.kind==='answer'&&job.chat_id===chat?.id);
 const waitingAnswer=backgroundAnswer(ws.jobs,chat?.id||null);
 const backgroundJob=waitingAnswer||completedAnswer;
 useEffect(()=>{if(!accountOpen)return;const close=(e:PointerEvent)=>{if(e.target instanceof Node&&!document.querySelector('.nu-account-menu')?.contains(e.target))setAccountOpen(false);};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[accountOpen]);
 const shownOutgoing=outgoing&&(outgoing.chat===chat?.id||!outgoing.chat&&sendInFlight)?outgoing:null;
 const pendingHere=pendingSend?.chat===chat?.id;
 const assistant=ws.assistant||(ws.assistant_ready?'ready':'disabled');
 const backgroundLabel=backgroundJob?.status==='complete'?'Answer ready':backgroundJob?assistantFeedbackState(backgroundJob,assistant,now)?.title||'Question waiting':'';
 useEffect(()=>{
  const completed=ws.jobs.find(j=>j.kind==='answer'&&['complete','failed'].includes(j.status)&&observedAnswers.current.has(j.id));
  if(completed&&(completed.chat_id!==chatRef.current?.id||tab!=='chat'))setCompletedAnswer(completed);
  for(const job of ws.jobs){if(job.kind!=='answer')continue;if(['queued','leased'].includes(job.status))observedAnswers.current.add(job.id);else observedAnswers.current.delete(job.id);}
  if(tab==='chat'&&completedAnswer?.chat_id===chat?.id)setCompletedAnswer(null);
 },[ws.jobs,tab,chat?.id]);
 useEffect(()=>{
  if(!waitingAnswer||waitingAnswer.chat_id===chat?.id)return;
  let pending=false;const timer=setInterval(async()=>{if(pending||document.visibilityState==='hidden')return;pending=true;try{await refresh();}catch{}finally{pending=false;}},15000);
  return()=>clearInterval(timer);
 },[waitingAnswer?.id,chat?.id]);
 const contentAvailable=ws.coverage.some(c=>(c.readiness?.indexed_sources||0)>0)||ws.sources.some(s=>!!(s.body||s.excerpt)?.trim())||ws.notes.some(n=>!!n.body.trim());
 const lastMessage=messages[messages.length-1];
 const responseKey=(lastMessage?lastMessage.id+':'+lastMessage.content.text.length:'')+'|'+(currentJob?.draft||'')+'|'+(shownOutgoing?.question||'')+'|'+(currentJob?.status||'');
 useLayoutEffect(()=>{if(resetPageScroll.current){resetPageScroll.current=false;window.scrollTo({top:0,behavior:"instant"});}},[tab]);
 useLayoutEffect(()=>{const anchor=pagingAnchor.current,scroller=conversationScroll.current;if(anchor&&scroller){scroller.scrollTop=anchor.top+scroller.scrollHeight-anchor.height;pagingAnchor.current=null;}},[messages]);
 useEffect(()=>{followLatest.current=true;setNewResponse(false);setAnswerRefreshError('');},[chat?.id,tab]);
 useEffect(()=>{if(tab!=='chat'||loading||studyOpen)return;const frame=requestAnimationFrame(()=>{const scroller=conversationScroll.current;if(!scroller)return;const answers=scroller.querySelectorAll<HTMLElement>('[data-answer-start]');const answer=answers[answers.length-1];const top=answer?answer.getBoundingClientRect().top-scroller.getBoundingClientRect().top+scroller.scrollTop:null;const target=conversationScrollTarget({following:followLatest.current,assistant:lastMessage?.role==='assistant'&&!shownOutgoing&&!['queued','leased'].includes(currentJob?.status||''),answerTop:top,bottom:scroller.scrollHeight,empty:!messages.length&&!outgoing});if(target!==null)scroller.scrollTop=target;else setNewResponse(true);});return()=>cancelAnimationFrame(frame);},[responseKey,chat?.id,tab,loading,messages.length,outgoing,studyOpen]);
 useEffect(()=>{const input=composerInput.current;if(!input)return;let width=input.clientWidth,frame=0;const fit=()=>{if(!input.isConnected)return;input.style.height='auto';input.style.height=Math.min(input.scrollHeight,180)+'px';};fit();const observer=new ResizeObserver(()=>{if(input.clientWidth===width)return;width=input.clientWidth;cancelAnimationFrame(frame);frame=requestAnimationFrame(fit);});observer.observe(input);window.addEventListener('resize',fit);return()=>{observer.disconnect();cancelAnimationFrame(frame);window.removeEventListener('resize',fit);};},[draft,tab,loading]);
 useEffect(()=>{setReadingAnswer(false);lastReadScroll.current=0;},[chat?.id,tab]);
 const compactComposer=messages.length>0&&(readingAnswer||!!source)&&!composerFocused&&!draft.trim()&&!draftRecovery.length&&!draftSaveError&&!pendingSend&&!sendInFlight;
 useLayoutEffect(()=>{
  const expanding=wasCompactComposer.current&&!compactComposer;wasCompactComposer.current=compactComposer;
  composerReveal.current?.cancel();
  if(!expanding||presentation.motion==='reduce'||window.matchMedia('(prefers-reduced-motion:reduce)').matches)return;
  const form=composerInput.current?.closest('form');
  composerReveal.current=form?.animate([{clipPath:'inset(45% 0 0 0 round 5px)',transform:'translateY(14px)',opacity:.45},{clipPath:'inset(0 0 0 0 round 5px)',transform:'translateY(0)',opacity:1}],{duration:360,easing:'cubic-bezier(.16,1,.3,1)'})||null;
  return()=>composerReveal.current?.cancel();
 },[compactComposer,presentation.motion]);
 function expandComposer(){setReadingAnswer(false);setComposerFocused(true);requestAnimationFrame(()=>composerInput.current?.focus());}
 useEffect(()=>{if(!focusComposer.current||tab!=='chat'||loading||busy)return;const input=composerInput.current;if(input){input.focus();focusComposer.current=false;}},[tab,loading,busy]);
 function jumpToLatest(){setReadingAnswer(false);const scroller=conversationScroll.current;if(scroller){const answers=scroller.querySelectorAll<HTMLElement>('[data-answer-start]');const answer=answers[answers.length-1];followLatest.current=true;scroller.scrollTop=lastMessage?.role==='assistant'&&answer?Math.max(0,answer.getBoundingClientRect().top-scroller.getBoundingClientRect().top+scroller.scrollTop-12):scroller.scrollHeight;setNewResponse(false);}}
 function startPrompt(value:string,mode:string){
  if(draftRef.current.trim()&&draftRef.current!==value){setNotice('Your current question is kept. Clear it before using a suggested question.');composerInput.current?.focus();return;}
  editDraft(value);if(chat)void settings({mode});else editPending({mode});composerInput.current?.focus();
 }
 function beginStudy(message:Message,approach:StudyApproach='explain',fresh=false){
  if(!chat||busy||!canLeaveDesk())return;
  const existing=studySessions.find(s=>s.originId===message.id&&s.phase==='study');
  if(existing&&!fresh){selectStudy(existing.id);setStudyMobileView('study');setStudyOpen(true);return;}
  const index=messages.findIndex(m=>m.id===message.id),question=[...messages.slice(0,index)].reverse().find(m=>m.role==='user')?.content.text||message.sources[0]?.title||'Review this saved answer';
  const refs=message.sources.filter((s,i,all)=>all.findIndex(other=>other.id===s.id)===i).slice(0,8).map(s=>({id:s.id,course_id:s.course_id,...(s.version_id?{version_id:s.version_id}:{})}));
  const courses=new Set(refs.map(s=>s.course_id));
  updateStudy({version:1,id:crypto.randomUUID(),chatId:chat.id,originId:message.id,question:question.slice(0,1000),courseId:chat.course_id||(courses.size===1?[...courses][0]:null),approach,goal:'',attempt:'',nextAction:'',plannedOn:'',noteUncertain:false,phase:'study',sourceRefs:refs,request:null,practiceQuestionId:null,noteId:null,planId:null,noteRequestId:crypto.randomUUID(),planRequestId:crypto.randomUUID()});
  setStudyMobileView('study');setStudyOpen(true);followLatest.current=false;
 }
 async function resumeStudy(id=study?.id){const selected=studySessions.find(s=>s.id===id);if(!selected||busy||!canLeaveDesk())return;if(chat?.id!==selected.chatId&&!await openChat(selected.chatId))return;selectStudy(selected.id);setStudyMobileView('study');setStudyOpen(true);followLatest.current=false;}
 const studyResult=study&&study.chatId===chat?.id?studyResponse(study,messages):null;
 const studyJob=study?.request?ws.jobs.find(j=>j.kind==='answer'&&j.chat_id===study.chatId&&j.question===study.request!.question):null;
 const studyPractice=study?.practiceQuestionId?messages.find(m=>m.id===study.practiceQuestionId&&m.role==='assistant'&&m.content.type==='answer'):null;
 async function askStudy(kind:StudyRequestKind){
  if(!study||study.chatId!==chat?.id||busy)return;
  if(kind==='explain'&&!study.goal.trim()){
   const index=messages.findIndex(m=>m.id===study.originId),user=[...messages.slice(0,index)].reverse().find(m=>m.role==='user');
   if(index>=0&&user){updateStudy(s=>({...s,request:{kind,question:user.content.text,afterId:null,userId:user.id}}));return;}
  }
  if(pendingSend||currentJob&&['queued','leased'].includes(currentJob.status))return;
  if(draft.trim()&&draft!==study.request?.question){setError('Send or clear your conversation draft before requesting another study step. Your draft is kept.');return;}
  const selected=study.sourceRefs.filter(s=>!study.courseId||s.course_id===study.courseId),context=selected.map(s=>s.id),pins=Object.fromEntries(selected.filter(s=>s.version_id).map(s=>[s.id,s.version_id!]));
  let configured=false;
  await run(async()=>{await draftSave.current;const saved=await persistChanges(chat!.id,{mode:'study',course_id:study.courseId,context,context_versions:pins,draft:draftRef.current});chatRef.current=saved;setChat(saved);configured=true;});
  if(!configured)return;if(!pinnedScope(scopeFor())){setError('Select exact saved versions for your sources before sending this question.');return;}
  const question=studyRequest(study,kind),afterId=messages.at(-1)?.id||null;
  updateStudy(s=>({...s,phase:'study',practiceQuestionId:kind==='practice-answer'?studyResult?.id||s.practiceQuestionId:s.practiceQuestionId,request:{kind,question,afterId,userId:null}}));
  const userId=await send(question);if(userId)updateStudy(s=>({...s,request:s.request?{...s.request,userId}:null}));
 }
 async function saveStudyNote(){
  if(!study?.courseId||!studyResult||study.noteId||study.noteUncertain)return;
  const title=('Study review — '+study.question).slice(0,180);
  const refs=studyResult.sources.map((s,i)=>`[${i+1}] ${s.title}\n/beta?tab=sources&source=${s.id}${s.version_id?'&version='+s.version_id:''}`).join('\n\n');
  const body=['AI-written study material. Review it against the original sources.','Question: '+study.question,'Approach: '+studyApproaches[study.approach],study.goal?'My goal: '+study.goal:'',study.attempt?'My attempt:\n'+study.attempt:'','Saved answer:\n'+studyResult.content.text,refs?'Saved sources:\n'+refs:'','Conversation:\n/beta?tab=chat&chat='+study.chatId].filter(Boolean).join('\n\n');
  await run(async()=>{
   if(body.length>80000)throw Error('This review is too long for one note. Your study session is kept.');
   let row:Note;try{row=await api('',{op:'note.create',course_id:study.courseId,title,body});}catch{updateStudy(s=>({...s,noteUncertain:true}));throw Error('The note save could not be confirmed. Check Notebook before creating another copy. Your study session is kept.');}
   updateStudy(s=>({...s,noteId:row.id}));setNotice('Study review saved to Notebook.');try{await refresh();}catch{setError('The review was saved. Reload to refresh your note list.');}
  });
 }
 async function saveStudyPlan(action:string,date:string|null){
  if(!study?.courseId||study.planId||!action)return;
  await run(async()=>{const row=await api('',{op:'plan.save',request_id:study.planRequestId,revision:0,course_id:study.courseId,parent_id:null,kind:'project',title:('Study — '+study.question).slice(0,180),state:'not_started',planned_on:date,next_action:action,source_id:null,version_id:null});updateStudy(s=>({...s,planId:row.id}));setNotice('Your chosen next action was saved to Today.');try{await refresh();}catch{setError('Your action was saved. Reload to refresh Today.');}});
 }
 function studyAnswer(message:Message){return <div className="nu-study-answer"><EvidenceChange sources={message.changed_sources} onOpen={(s,trigger)=>openSource(s,trigger)}/><MessageSources.Provider value={{sources:message.sources,open:openSource}}><Markdown remarkPlugins={[remarkMath,[studyCitations,{hrefs:message.sources.map(sourceReferenceHref)}]]} rehypePlugins={[rehypeKatex]} skipHtml components={messageComponents}>{message.content.text}</Markdown></MessageSources.Provider><details><summary>{ui("Selected saved sources (")}{message.sources.length})</summary>{message.sources.map(s=><button key={sourceReferenceHref(s)} onClick={e=>openSource(s,e.currentTarget)}>{s.title}</button>)}</details></div>;}
 useEffect(()=>{const main=mainPanel.current?.querySelector('main');if(!main||loading||presentation.motion==='reduce'||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;const motion=main.animate?.([{opacity:.35,transform:'translateY(9px)'},{opacity:1,transform:'translateY(0)'}],{duration:320,easing:'cubic-bezier(.2,.8,.2,1)'});return()=>motion?.cancel();},[tab,loading,presentation.motion]);
 const searchText=query.trim(),searchCurrent=!!searchText&&searchText===searchedQuery;
 const [sourceKind,setSourceKind]=useState(''),[contextCourse,setContextCourse]=useState(''),[sourceView,setSourceView]=useState<'coursework'|'all'>('all'),[courseContextOpen,setCourseContextOpen]=useState(false);
 const library=useSourceLibrary(tab==='sources'&&sourceView==='all'&&!loading,course,sourceKind,searchedQuery||'',api);
 function addReadableCopy(id:string){
  if(historyPending.current||!canLeaveDesk()||!canLeaveCalendar('sources'))return;
  go('sources',undefined,true);
  changeLibraryCourse(id);
  setReadableCopy({course:id});
  showImport();
 }
 function changeLibraryCourse(id:string){setCourse(id);const url=new URL(window.location.href);if(id)url.searchParams.set('course',id);else url.searchParams.delete('course');window.history.replaceState(null,'',url.pathname+url.search);currentAddress.current=url.pathname+url.search;}
 async function savedCourseFile(saved:Source,single:boolean,trigger?:HTMLElement){
  const preview=single&&tabRef.current==='sources'&&!dialog.current?.open;
  if(preview){changeLibraryCourse(saved.course_id);setSourceView('all');setSourceKind('file');setQuery('');setSearchedQuery(null);}
  library.reload();
  await Promise.all([refresh(),preview?openSource(saved,trigger,true):Promise.resolve()]);
 }
 const searching=library.loading,searchError=library.error,pageSources=library.data?.sources||[],sourceTotal=library.data?.total??0;
 const pageCount=Math.max(1,Math.ceil(sourceTotal/20)),safePage=library.page;
 const sourceList=useRef<HTMLDivElement>(null),focusSourcePage=useRef(false);
 useEffect(()=>{if(!focusSourcePage.current||searching)return;const first=sourceList.current?.querySelector<HTMLButtonElement>('button');if(first){first.focus();first.scrollIntoView({block:'start'});focusSourcePage.current=false;}},[safePage,searching]);
 const [noteOrigin,setNoteOrigin]=useState('all');
 const filteredNotes=ws.notes.filter(n=>(noteOrigin==='all'||(noteOrigin==='practice'?n.origin==='ai_draft':n.origin!=='ai_draft'))&&(!course||n.course_id===course)&&(!noteQuery.trim()||n.title.toLocaleLowerCase().includes(noteQuery.trim().toLocaleLowerCase())));
 function assignmentFor(sourceId:string,courseId:string){
  const matches=ws.tasks.filter(task=>task.source_id===sourceId&&task.course_id===courseId&&task.evidence?.active!==false);
  return matches.length===1?matches[0]:undefined;
 }
 const pinnedAssignment=chat?.course_id&&chat.context.length===1&&chat.context_versions?.[chat.context[0]]?assignmentFor(chat.context[0],chat.course_id):undefined;
 const currentDeskSelection=deskSelection&&deskSelection.chat===chat?.id?deskSelection:null;
 const deskTask=(currentDeskSelection&&ws.tasks.find(task=>task.id===currentDeskSelection.task&&task.evidence?.active!==false))||pinnedAssignment;
 const deskTitle=deskTask?String(deskTask.evidence?.title||ws.sources.find(source=>source.id===deskTask.source_id)?.title||ui('Saved activity')):'';
 const deskSource:Source|undefined=deskTask?(ws.sources.find(source=>source.id===deskTask.source_id)||{id:deskTask.source_id,course_id:deskTask.course_id,title:deskTitle,kind:'moodle',version_id:typeof deskTask.evidence?.version_id==='string'?deskTask.evidence.version_id:undefined}):undefined;
 const pinnedVersion=pinnedAssignment&&chat?.context_versions?.[pinnedAssignment.source_id];
 const showDesk=!!deskTask&&!!ws.planning&&!deskCollapsed&&!studyOpen;
 function openDeskPlan(task:BetaTask,suggestion:string,trigger:HTMLElement){
  if(!chat||deskTask?.id!==task.id&&!canLeaveDesk())return;
  deskPlanButton.current=trigger;deskPlanFocus.current=true;
  setStudyOpen(false);setDeskSelection({chat:chat.id,task:task.id,suggestion});setDeskCollapsed(false);
 }
 useEffect(()=>{if(showDesk&&deskPlanFocus.current){deskPlanFocus.current=false;deskPlanHeading.current?.focus();}},[showDesk,deskTask?.id,currentDeskSelection]);
 function planFromAnswer(message:Message,row:string[],head:string[]){
  if(!ws.planning||message.role!=='assistant'||message.content.type!=='answer'||!['Work',ui('Work')].includes(head[0])||!['Next action',ui('Next action')].includes(head[2]))return null;
  const [title,,step]=row,match=step.match(/\s\[(\d+)\]$/),ref=match?message.sources?.[Number(match[1])-1]:undefined;
  if(!ref?.version_id||!match)return null;
  const task=assignmentFor(ref.id,ref.course_id);
  const taskTitle=task?.evidence?.title,code=ws.courses.find(course=>course.id===ref.course_id)?.code;
  if(!task||typeof taskTitle!=='string'||!matchesPlanningWorkTitle(title,taskTitle,code||'')||task.evidence?.version_id!==ref.version_id)return null;
  const suggestion=step.slice(0,match.index).split(' Why: ')[0].trim().slice(0,600);
  return suggestion?<button type="button" className="nu-answer-plan" aria-label={ui('Plan this assignment')+' · '+taskTitle} onClick={event=>openDeskPlan(task,suggestion,event.currentTarget)} disabled={busy}>{ui('Plan this assignment')}</button>:null;
 }
 useEffect(()=>{
  if(loading||loadFailed||local||actor.demo||guidedEntryChecked.current)return;
  guidedEntryChecked.current=true;
  const query=new URL(window.location.href).searchParams;
  if(tab==='today'&&!query.has('tab')&&!query.has('chat')&&!ws.courses.length&&!ws.notes.length&&!ws.chats.length){
   setTab('setup');
   const address=workspaceHref('setup');
   window.history.replaceState(null,'',address);currentAddress.current=address;
  }
 },[loading,loadFailed,local,actor.demo,tab,ws.courses.length,ws.notes.length,ws.chats.length]);
 const activeStudy=studyOpen&&study?.chatId===chat?.id;
 const coverageLink=(id:string)=>'/beta?tab=sources&course='+encodeURIComponent(id);
 const calendarCourses=ws.courses.filter(c=>!ws.planning||ws.planning.current_course_ids.includes(c.id)).map(c=>({...c,code:displayCourseLabel(c)}));
 const scheduleForm=<ScheduleForm disabled={scheduleDirty||busy} initialCourseId={scheduleCourse} courses={calendarCourses} onDirtyChange={setScheduleDirty} sources={ws.sources} onSave={async(source_id,schedule)=>{scheduleSaving.current=true;try{await api('',{op:'meeting.create',source_id,schedule});try{await refresh();}catch{setError('Your class time was saved. Reload Neyvu to refresh the calendar.');}}finally{scheduleSaving.current=false;}}}/>;
 const todayCoverage=showTodayCoverage&&<TodayCoverage coverage={ws.coverage} title={courseLabel} sourceLink={coverageLink} onAddReadableCopy={addReadableCopy} onConnect={()=>go('connection')}
  calendarCourseIds={calendarCourses.map(c=>c.id)} meetings={ws.meetings} classTimeDisabled={busy||scheduleDirty}
  onAddClassTime={id=>{if(go('calendar')){openScheduleReview.current=true;setScheduleCourse(id);}}}
  revision={(ws.planning?.course_scope?.binding_revision||'')+':'+ws.coverage.map(c=>c.course_id+':'+c.last_capture).join(',')}/>;
 const deskCoverage=!local&&<details className="nu-desk-coverage"><summary>{ui('Moodle coverage')}</summary><MoodleFreshness coverage={ws.coverage} scope={tab==='chat'&&chat?.course_id?[chat.course_id]:ws.planning?.current_course_ids} now={now} timezone={actor.timezone} onConnect={()=>go('connection')}/></details>;
 const sending=busy||draftRecovery.length>0||!!pendingSend||!draft.trim()||!!currentJob&&['queued','leased'].includes(currentJob.status);
 if(tab==='setup'&&!actor.demo&&!local)return <div className="beta-app nu-study-desk nu-guided-background">
  {error&&<p className="beta-alert" role="alert">{ui(error)}</p>}
  <GuidedSetup onSchedule={()=>{openScheduleReview.current=true;go('calendar');}} onFiles={id=>{setCourse(id);setSetupFiles(true);showImport();go('sources');}} timezone={actor.timezone} onLeave={()=>go('today')} onAsk={async (courseId,question)=>{
   setError('');
   try{await refresh();}
   catch{setError(language==='es'?'No se pudo abrir Chat. Inténtalo de nuevo.':'Chat could not open. Try again.');return false;}
   return newChat({courseId,question});
  }}/>
 </div>;
 return <div className={'beta-app nu-workspace-polish nu-app-shell nu-study-desk'+(tab==='chat'?' beta-chat-view':'')+(source?' nu-source-open':'')} style={{'--nu-source-width':sourceWidth+'px'} as React.CSSProperties}><a href="#beta-main" className="beta-skip" tabIndex={nav?-1:undefined}>{ui("Skip to content")}</a><aside ref={navPanel} id="beta-navigation" role={nav?'dialog':undefined} aria-modal={nav?true:undefined} aria-label={nav?ui("Workspace navigation"):undefined} className={nav?'beta-nav beta-nav-open':'beta-nav'}><header><a href="/beta" className="beta-wordmark" aria-label={PRODUCT_NAME}><img className="nu-rail-symbol" src={SYMBOL} width="30" height="30" alt=""/><img className="beta-brand-dark" src={WORDMARK} width="138" height="35" alt={PRODUCT_NAME}/><img className="beta-brand-light" src={WORDMARK_LIGHT} width="138" height="35" alt={PRODUCT_NAME}/></a><button aria-label={ui("Close navigation")} className="beta-nav-close" onClick={()=>setNav(false)}><X size={20} aria-hidden="true"/></button></header><WorkspaceNavigation tab={tab} local={local} captureEnabled={captureEnabled} unseenUpdates={unseenUpdates} href={workspaceHref} onNavigate={(e,key)=>{if(ordinaryClick(e)){e.preventDefault();go(key);}}}/>{(tab==='chat'||tab==='today')&&<div className="beta-history"><p>{ui("Recent chats")}</p>{ws.chats.length>=listLimit&&listLimit<200&&<button disabled={busy} onClick={loadMore}>{ui("Load older chats")}</button>}{ws.chats.filter(c=>!c.archived&&(c.title!=='New chat'||c.draft.trim())).slice(0,8).map(c=><a key={c.id} href={workspaceHref('chat',c.id)} title={c.title==='New chat'?ui('New chat'):c.title} aria-current={tab==='chat'&&chat?.id===c.id?'true':undefined} onClick={e=>{if(ordinaryClick(e)){e.preventDefault();openChat(c.id);}}}><span>{c.title==='New chat'?ui('New chat'):c.title}</span><small>{c.course_id?courseLabel(c.course_id):ui('All courses')}{c.updated_at&&Number.isFinite(Date.parse(c.updated_at))&&<time dateTime={c.updated_at}>{new Intl.DateTimeFormat(locale,{timeZone:actor.timezone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(c.updated_at))}</time>}</small></a>)}{ws.chats.length>8&&<small>{ui("Find a conversation by its title.")}</small>}{!ws.chats.length&&<small>{ui("Your conversations will appear here.")}</small>}</div>}<footer><span>{actor.name||actor.email}</span><button aria-label={ui("Sign out")} onClick={()=>{if(canLeaveCalendar('signout')&&(!dirty||window.confirm(ui('Sign out with unsaved note changes? Save your note first to keep them.'))))run(async()=>{await api('',{op:'signout'});window.location.assign('/beta');});}}><LogOut size={18} aria-hidden="true"/></button></footer></aside>{nav&&<button className="beta-shade" aria-hidden="true" tabIndex={-1} onClick={()=>setNav(false)}/>}
 <div ref={mainPanel} className="beta-main" data-view={tab}><header className="beta-top"><button ref={navTrigger} className="beta-menu" aria-label={ui("Open navigation")} aria-expanded={nav} aria-controls="beta-navigation" onClick={()=>setNav(true)}><Menu size={21} aria-hidden="true"/></button><span title={tab==='chat'?chat?.title:undefined}>{tab==='chat'?(chat?.title&&chat.title!=='New chat'?chat.title:ui("Chat")):tab==='today'?ui("Today"):tab==='notes'?ui("Notes"):tab==='classes'?ui("Class recordings"):tab==='updates'?ui("Updates"):tab==='sources'?ui("Courses"):tab==='settings'?ui("Settings"):tab==='connection'?(local?ui("Personal vault"):ui("Moodle")):ui("Calendar")}</span><div className="beta-top-tools">{(tab==='today'||tab==='chat')&&<button type="button" className="nu-desk-new" onClick={()=>void newChat()} disabled={busy} aria-label={ui("New chat")} title={ui("New chat")}><Plus size={18} aria-hidden="true"/><span>{ui("New chat")}</span></button>}<WorkspaceFind chats={ws.chats} courses={ws.courses} onCourse={id=>void newChat({courseId:id})} onChat={id=>void openChat(id)} onSource={openSource} courseName={courseLabel}/><small>{local?ui("Local vault"):actor.demo?ui("Demo account"):ui("Neyvu at Acadia")}</small>{!actor.demo&&<PilotReport disabled={local}/>}<details className="nu-account-menu" open={accountOpen} onToggle={e=>setAccountOpen(e.currentTarget.open)} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();setAccountOpen(false);e.currentTarget.querySelector('summary')?.focus();}}}><summary aria-label={ui("Account")}><span className="nu-account-label">{ui("Account")}</span> <ChevronDown size={16} aria-hidden="true"/></summary><div className="nu-account-content"><strong>{actor.name||ui("Your account")}</strong><a href={workspaceHref('settings')} onClick={e=>{if(ordinaryClick(e)){e.preventDefault();go('settings');}}}><Settings size={17} aria-hidden="true"/>{ui("Settings")}</a><LanguageSelect compact/><Appearance/><button disabled={busy} onClick={()=>{if(canLeaveCalendar('signout')&&(!dirty||window.confirm(ui('Sign out with unsaved note changes? Save your note first to keep them.'))))run(async()=>{await api('',{op:'signout'});window.location.assign('/beta');});}}>{ui("Sign out")}</button></div></details></div></header><main id="beta-main" tabIndex={-1} data-view={tab}>
 {tab==='connection'&&!actor.demo&&!local&&<button type="button" onClick={()=>go('setup')}>{language==='es'?'Abrir configuración guiada':'Open guided setup'}</button>}
 {tab==='connection'&&!actor.demo&&!local&&<Onboarding showCompleted revision={ws.courses.length+':'+ws.sources.length+':'+ws.notes.length+':'+messages.length} onNavigate={next=>go(next)}/>}
 {!['calendar','today','chat'].includes(tab)&&!local&&<MoodleFreshness coverage={ws.coverage} scope={course?[course]:ws.planning?.current_course_ids} now={now} timezone={actor.timezone} onConnect={()=>go('connection')}/>}
 {uploadActive&&tab!=='sources'&&<button className="beta-running-task" onClick={()=>go('sources')}>{ui("Saving your files · Open materials")}</button>}

 {tab!=='chat'&&backgroundJob&&<div className="nu-background-progress"><button disabled={busy} onClick={()=>{setCompletedAnswer(null);if(backgroundJob.chat_id)void openChat(backgroundJob.chat_id);}}><MessageSquare size={16} aria-hidden="true"/><span>{backgroundLabel}</span><span>{ui("Open conversation")}</span></button></div>}
 {actor.demo&&<div className="beta-demo-banner" role="note"><div><strong>{ui("Demo data — not a real student account")}</strong><span>{ui("Synthetic courses and materials, shared by everyone using this demo code. No real student data.")}</span></div><button onClick={resetDemo} disabled={busy}>{ui("Reset demo data")}</button></div>}
 {openingSource&&<p className="nu-search-activity" role="status"><span aria-hidden="true"/>{ui('Opening saved source:')} {openingSource}</p>}
 {(error||notice)&&<div className={error?'beta-alert':'beta-notice'} role={error?'alert':'status'}>{ui(error||notice)}{error&&<button aria-label={ui("Dismiss message")} onClick={()=>setError('')}><X size={16} aria-hidden="true"/></button>}</div>}
 {!loading&&!chatCreating&&creationRecovery.length>0&&<section className="beta-notice" aria-label={ui("Interrupted conversation creation")}><p>{ui("A conversation request was interrupted. Check it to recover the same conversation. No question will be sent.")}</p>{creationRecovery.map(record=><button key={record.id} disabled={busy||draftRecovery.length>0} onClick={()=>void checkCreation(record)}>{ui("Check interrupted conversation")}{record.initial.draft?' · '+record.initial.draft.slice(0,70):' · '+ui("New chat")}</button>)}</section>}
 {loading?<WorkspaceOpening/>:loadFailed?<WorkspaceState kind="error" heading="h1" title={ui("Your saved materials could not be loaded.")} description={ui("Check your connection and try again. If your session expired, sign in again.")} actionLabel={ui("Retry loading")} onAction={retryLoad}><a href={showTodayCoverage?todayCoverageTarget:'/beta'}>{ui("Sign in again")}</a></WorkspaceState>:<>
 {captureActive&&tab!=='classes'&&<p role="status" className="beta-class-warning">{ui("Class recording has unsaved work.")} <button onClick={()=>go('classes')}>{ui("Open recording")}</button></p>}
 {!showTodayCoverage&&!ws.courses.length&&!['connection','chat'].includes(tab)&&<section className="beta-onboarding"><h2>{ui("Bring your courses into view.")}</h2><p>{local?ui("Import your personal vault, or add a course to start taking notes."):ui("Connect your own Moodle account, or add a course to start taking notes.")}</p><button onClick={()=>go('connection')} className="beta-primary">{local?ui("Import personal vault"):ui("Connect Moodle")}</button><button onClick={()=>{setAddingCourse(true);go('notes');}}>{ui("Add a course manually")}</button></section>}
 {tab==='settings'&&<WorkspaceSettings timezone={actor.timezone} counts={{notes:ws.notes.length,sources:ws.sources.length,chats:ws.chats.filter(c=>!c.archived).length}} onBrowserCopies={()=>browserCopies.review(()=>busyRef.current||chatCreating||dirtyRef.current||plannerDirty||deskPlanDirty.current||scheduleSaving.current||captureActiveRef.current||uploadActive||!!memoryTrigger?'Finish active work and save unsaved notes or plans before reviewing browser removal.':null)} onOpen={go} onMemory={setMemoryTrigger}/>}
 {tab==='connection'&&(local?<LocalConnection onRefresh={refresh} onNavigate={go} timezone={actor.timezone}/>:<MoodleConnection demo={actor.demo===true} onCollected={refresh}/>)}
 {!local&&tab==='connection'&&ws.coverage?.length>0&&<CourseReadinessPanel coverage={ws.coverage} title={courseLabel} onAddReadableCopy={addReadableCopy} sourceLink={coverageLink}/>}
 {tab==='chat'&&<div className={"nu-chat-workspace"+(activeStudy?" nu-chat-workspace-study":"")+(showDesk?" nu-chat-workspace-assignment":"")} data-mobile-view={studyMobileView}>{activeStudy&&<div className="nu-chat-view-switch" role="group" aria-label={ui("Conversation workspace")}><button type="button" aria-pressed={studyMobileView==='conversation'} onClick={()=>setStudyMobileView('conversation')}>{ui("Conversation")}</button><button type="button" aria-pressed={studyMobileView==='study'} onClick={()=>setStudyMobileView('study')}>{ui("Study")}</button></div>}<div className="beta-conversation" data-empty={!messages.length&&!shownOutgoing}>
  <div ref={conversationScroll} className="beta-conversation-scroll" onScroll={e=>{const el=e.currentTarget;const delta=el.scrollTop-lastReadScroll.current;lastReadScroll.current=el.scrollTop;if(delta < -4)setReadingAnswer(true);else if(delta>4&&el.scrollHeight-el.scrollTop-el.clientHeight<24)setReadingAnswer(false);followLatest.current=el.scrollHeight-el.scrollTop-el.clientHeight<100;if(followLatest.current)setNewResponse(false);}}>
   {offline&&!currentJob&&(chat?.mode||pendingMode)!=='sources'&&<div className="beta-offline" role="status"><strong>{ui("Assistant offline")}</strong><p>{ui("Your questions can wait here until it returns. Notes and Find sources are available.")}</p></div>}

   {!messages.length&&!shownOutgoing?<section className="beta-welcome">
    <span className="beta-welcome-mark" aria-hidden="true"><img className="beta-brand-dark" src={SYMBOL} width="48" height="48" alt=""/><img className="beta-brand-light" src={SYMBOL_LIGHT} width="48" height="48" alt=""/></span>
    <h1>{pinnedAssignment?ui('Ask about this assignment'):!ws.courses.length?ui("Add your courses."):contentAvailable?ui("What would help right now?"):ui("Add your course materials.")}</h1>
    <p>{pinnedAssignment?ui("Ask about the saved instructions, or turn them into a plan."):!ws.courses.length?(local?ui("Import your personal vault, or add a course for your notes."):ui("Connect Moodle to bring in your active courses and their materials.")) :contentAvailable?ui("Ask about your courses. We can work out the next step together."):ui("Your courses are here. Connect Moodle, upload a file or write notes so the assistant has material to use.")}</p>
    {!ws.courses.length?<div className="beta-welcome-actions"><button className="beta-primary" onClick={()=>go('connection')}>{local?ui("Import personal vault"):ui("Connect Moodle")}</button><button onClick={()=>{setAddingCourse(true);go('notes');}}>{ui("Add a course manually")}</button></div>:contentAvailable?<div className="beta-prompts">
     <button disabled={busy} onClick={()=>startPrompt('Help me prioritize this week. Give a short ranked list with deadlines, reasons and a concrete next action. Do not schedule study blocks.','plan')}><CalendarDays size={18} aria-hidden="true"/><span>{ui("Prioritize my week")}</span></button>
     <button disabled={busy} onClick={()=>startPrompt('What is due next, and what should I do first?','ask')}><FileText size={18} aria-hidden="true"/><span>{ui("What is due next?")}</span></button>
     <button disabled={busy} onClick={()=>startPrompt('What have I submitted, and what is still unfinished?','ask')}><BookOpen size={18} aria-hidden="true"/><span>{ui("Check my submissions")}</span></button>
    </div>:<div className="beta-welcome-actions"><button className="beta-primary" onClick={()=>go('connection')}>{local?ui("Import personal vault"):ui("Connect Moodle")}</button><button onClick={()=>go('sources')}>{ui("Add a file")}</button><button onClick={()=>go('notes')}>{ui("Write notes")}</button></div>}
    {contentAvailable&&<div className="beta-workspace-links"><button disabled={busy} onClick={()=>go('today')}><CalendarDays size={16} aria-hidden="true"/>{ui("Open Today")}</button><button disabled={busy} onClick={()=>go('notes')}><BookOpen size={16} aria-hidden="true"/>{ui("Open Notes")}</button></div>}
    {!actor.demo&&!local&&<button type="button" className="nu-setup-entry" onClick={()=>go('setup')}>{ui("Review your setup")}</button>}
   </section>:<div className="beta-messages" role="log" aria-label={ui("Conversation messages")} aria-live="polite" aria-relevant="additions">
    {olderMessages&&<button disabled={busy} onClick={loadOlder}>{ui("Load earlier messages")}</button>}
    {messages.map(m=><article key={m.id} className={'beta-message beta-message-'+m.role} aria-label={m.role==='user'?ui("Your question"):ui("{value0} answer",{value0:PRODUCT_NAME})}>
     <header className="nu-answer-heading" data-answer-start={m.role==='assistant'?true:undefined}><EvidenceLabel>{m.role==='user'?ui("You"):PRODUCT_NAME}</EvidenceLabel>{m.role==='assistant'&&<span>{m.sources?.length?ui(m.sources.length===1?'{count} source available':'{count} sources available',{count:m.sources.length}):ui("No sources attached")}</span>}</header><EvidenceChange sources={m.changed_sources} onOpen={(s,trigger)=>openSource(s,trigger)}/>{m.role==='assistant'&&m.content.type==='answer'&&m.sources?.some(s=>s.returned_feedback?.format===1&&s.returned_feedback.version_id===s.version_id)&&<FeedbackWorkspace messageId={m.id} autoOpen={m.content.text.startsWith('## Feedback and current passage')} courseId={chat?.course_id||null} canPrepare={!busy&&!draft.trim()&&!draftRecovery.length} onPrepare={question=>{if(busy||draftRef.current.trim()||draftRecovery.length)return;editDraft(question);requestAnimationFrame(()=>composerInput.current?.focus());}} onOpen={openSource}/>}<div className="nu-answer-body"><MessageSources.Provider value={{sources:m.sources||[],membership:m.content.moodle_membership?.course_id===m.content.context_course_id?m.content.moodle_membership:undefined,open:openSource}}><AnswerBody text={m.content.text} rowAction={(row,head)=>planFromAnswer(m,row,head)} render={text=><Markdown remarkPlugins={[remarkMath,[studyCitations,{hrefs:(m.sources||[]).map(sourceReferenceHref)}]]} rehypePlugins={[rehypeKatex]} skipHtml components={messageComponents}>{text}</Markdown>}/></MessageSources.Provider></div>
     {m.role==='assistant'&&m.content.type==='answer'&&m.content.clarification?.kind==='group'&&m.id===messages[messages.length-1]?.id&&<GroupClarificationChips messageId={m.id} clarification={m.content.clarification} disabled={busy||!!draft.trim()||!!draftRecovery.length} onChosen={()=>reaskAfterGroup(m)}/>}
     {m.role==='assistant'&&m.content.type==='answer'&&ws.planning?.plans.filter(plan=>plan.kind==='project'&&plan.state!=='archived'&&m.sources?.some(ref=>ref.id===plan.source_id&&ref.course_id===plan.course_id&&ref.version_id===ws.sources.find(source=>source.id===ref.id)?.version_id)).slice(0,3).map(plan=><section key={plan.id} className="nu-answer-linked-plan" aria-label={ui('Plan linked to this answer')}>
      <button type="button" disabled={busy} aria-expanded={answerPlan?.message===m.id&&answerPlan.plan===plan.id} onClick={()=>{if(!canLeaveDesk())return;setAnswerPlan(answerPlan?.message===m.id&&answerPlan.plan===plan.id?null:{message:m.id,plan:plan.id});}}>{ui('Update saved plan')} · {plan.title}</button>{!(answerPlan?.message===m.id&&answerPlan.plan===plan.id)&&<p className="nu-saved-next-step">{plan.next_action}</p>}
      {answerPlan?.message===m.id&&answerPlan.plan===plan.id&&<><p>{ui('Keep your chosen next step beside this answer. Review the cited instructions before saving.')}</p><PlanEditor compact plan={plan} courseId={plan.course_id} sources={ws.sources} zone={actor.timezone} onDirty={reportDeskDirty} onSave={savePlanning} onOpen={id=>openSource(ws.sources.find(source=>source.id===id)||{id} as Source)} onVersion={ref=>openSource({id:ref.source_id,version_id:ref.version_id} as Source)}/></>}
     </section>)}
     {m.sources?.length>0&&<details><summary>{m.sources.length} {m.sources.length===1?ui("source"):ui("sources")}  {ui("· View evidence")}</summary>{m.sources.map((s,i)=><div className="beta-citation" key={sourceReferenceHref(s)}><button data-beta-source={s.id} data-beta-version={s.version_id} onClick={e=>openSource(s,e.currentTarget)}><span>[{i+1}]</span> {s.title}</button><p>{s.excerpt?.slice(0,600)}</p></div>)}</details>}
     {m.role==='assistant'&&m.content.type==='answer'&&(isWithheldExample(m.content.text)?<AnswerRecovery onMaterials={()=>go('sources')} canPrepare={!busy&&!draft.trim()} onFollowup={()=>{if(busy||draft.trim())return;setDraft(sourceRecoveryFollowup);requestAnimationFrame(()=>composerInput.current?.focus());}}/>:<AnswerActions messageId={m.content.job_id?m.id:undefined} jobId={m.content.job_id||undefined} text={m.content.text} disabled={busy} onStudy={()=>beginStudy(m)} studyHref={m.content.job_id?'/beta/study/'+encodeURIComponent(m.id):undefined}/>)}
    </article>)}
    {shownOutgoing&&<article className="beta-message beta-message-user beta-message-outgoing" aria-label={ui("Your question awaiting confirmation")}><p>{shownOutgoing.question}</p><small>{sendInFlight?ui("Sending…"):ui("Waiting for confirmation")}</small></article>}
   </div>}
   {!activeStudy&&currentJob&&currentJob.status==='failed'&&currentJob.draft&&<article className="beta-message beta-message-assistant beta-answer-draft" aria-label={ui("Unfinished answer draft")}><small>{ui("Unfinished draft · This answer stopped before completion.")}</small><Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} skipHtml components={messageComponents}>{currentJob.draft}</Markdown></article>}
   {!activeStudy&&<AssistantFeedback job={currentJob} onEditQuestion={currentJob?.question&&!draft.trim()?()=>{editDraft(currentJob.question!);requestAnimationFrame(()=>composerInput.current?.focus());}:undefined} sending={sendInFlight} assistant={assistant} now={now} onRefresh={checkAnswerStatus} refreshing={answerRefreshing} onOpenMaterials={()=>go('sources')} onOpenNotebook={()=>go('notes')}/>}
   {answerRefreshError&&<div className="beta-answer-recovery"><p role="alert">{ui(answerRefreshError)}</p><button disabled={answerRefreshing} onClick={checkAnswerStatus}>{ui("Check status")}</button></div>}
   {currentJob?.status==='complete'&&currentJob.study_note_id&&<p role="status" className="beta-answer-status">{ui("Study draft saved in your Notebook. Review it against the original sources.")}</p>}
   {currentJob?.status==='complete'&&currentJob.study_note_skipped&&<p role="status" className="beta-answer-status">{ui("Your answer is saved. Its study draft could not be added to the Notebook; check your account limits.")}</p>}
   {pendingSend&&!sendInFlight&&<div className="beta-answer-recovery"><p role="status">{ui("Your question is kept. Neyvu automatically checks the same saved request when connected. You can keep using your notes and sources.")}</p>{pendingHere?<button disabled={busy} onClick={()=>send(pendingSend.question,true)}>{ui(recoveringSend?"Checking saved request…":"Check saved request")}</button>:<button disabled={busy} onClick={()=>openChat(pendingSend.chat)}>{ui("Open saved question")}</button>}</div>}
  </div>
  {newResponse&&<button className="beta-jump-latest" onClick={jumpToLatest}>{ui("New answer or update")} <ArrowUp size={15} aria-hidden="true"/></button>}
  <>
  {deskTask&&<div className="nu-desk-context"><button type="button" className="nu-desk-context-chip" aria-expanded={showDesk} aria-controls="beta-assignment-desk" onClick={event=>{if(showDesk){setDeskCollapsed(true);return;}deskPlanButton.current=event.currentTarget;deskPlanFocus.current=true;setDeskCollapsed(false);setStudyOpen(false);}}><FileText size={15} aria-hidden="true"/>{deskTitle}</button>{pinnedAssignment&&<small>{deskTask.id===pinnedAssignment.id?ui('Instructions attached'):ui('Chat instructions: {title}',{title:String(pinnedAssignment.evidence?.title||ui('Saved activity'))})}</small>}</div>}
  {!pinnedAssignment&&chat?.context?.length>0&&<p role="status" className="beta-context-selection">{ui("Selected saved sources (")}{chat.context.length}) <button disabled={busy} onClick={()=>settings({context:[]})}>{ui("Clear")}</button></p>}
  <button hidden={compactComposer} className="nu-memory-link" onClick={e=>setMemoryTrigger(e.currentTarget)}>{ui("Remembered information")}</button>
  {compactComposer&&<button type="button" className="nu-compact-reply" onClick={expandComposer}><span>{ui('Reply to Neyvu')}</span><small>{chat?.course_id?courseLabel(chat.course_id):ui('All courses')}{chat?.context?.length?` · ${chat.context.length} ${ui('sources')}`:''}</small><ArrowUp size={17} aria-hidden="true"/></button>}
  <form hidden={compactComposer} className="beta-composer" onFocusCapture={()=>setComposerFocused(true)} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setComposerFocused(false);}} onSubmit={e=>{e.preventDefault();if(!sending)send();}}>
   {draftRecovery.length>0&&<div className="beta-answer-recovery beta-draft-recovery" role="status"><p>{ui('Different unsent drafts or source selections were found. Choose one before saving or sending.')}</p><p>{ui('Other copies shown here are cleared only after the chosen draft is kept safely.')}</p><details><summary>{ui('Saved draft')}</summary><p>{chat?.course_id?courseLabel(chat.course_id):ui('All courses')} · {ui(({ask:'Ask',plan:'Plan',study:'Study',solve:'Solve',sources:'Find sources'} as Record<string,string>)[chat?.mode||pendingMode])}</p><pre>{savedDraft}</pre>{chat?.context.map(id=><div key={id}><strong>{ws.sources.find(source=>source.id===id)?.title||ui('Previously selected source')}</strong><small>{ui(chat.context_versions?.[id]?'Saved version':'Version not pinned')}</small><button type="button" disabled={busy} onClick={()=>openSource({id,version_id:chat.context_versions?.[id]} as Source)}>{ui('Review saved selection')}</button></div>)}</details>{[...new Map(draftRecovery.map(r=>[JSON.stringify([r.text,scopeKey(r)]),r])).values()].map(choice=><div key={choice.revision}><p>{choice.course_id?courseLabel(choice.course_id):ui('All courses')} · {ui(({ask:'Ask',plan:'Plan',study:'Study',solve:'Solve',sources:'Find sources'} as Record<string,string>)[choice.mode])}</p><p>{ui('Selected sources: {count}',{count:choice.context.length})}</p>{choice.context.map(id=><div key={id}><strong>{ws.sources.find(source=>source.id===id)?.title||ui('Previously selected source')}</strong><small>{ui(choice.context_versions[id]?'Saved version':'Version not pinned')}</small><button type="button" disabled={busy} onClick={()=>openSource({id,version_id:choice.context_versions[id]} as Source)}>{ui('Review selected source')}</button></div>)}{choice.base_scope===null&&<p>{ui('This older recovery copy did not record source versions. Only its text can be recovered with the current saved selection.')}</p>}<pre>{choice.text||ui('(Empty draft)')}</pre><button type="button" disabled={busy} onClick={()=>chooseDraft(choice)}>{ui(choice.base_scope===null?'Recover text with saved sources':'Use this draft and its sources')}</button>{choice.base_scope!==null&&<button type="button" disabled={busy} onClick={()=>chooseDraft(choice,true)}>{ui('Recover text with current selection')}</button>}</div>)}<button type="button" disabled={busy} onClick={()=>chooseDraft(null)}>{ui('Keep saved draft')}</button></div>}
   <textarea ref={composerInput} rows={1} name="message" autoComplete="off" aria-label={ui("Message {value0}",{value0:PRODUCT_NAME})} aria-describedby="beta-message-hint" onKeyDown={e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)&&!e.nativeEvent.isComposing){e.preventDefault();if(!sending)send();}}} placeholder={ui(pinnedAssignment?"Ask about this assignment…":"Ask about your courses…")} disabled={busy||draftRecovery.length>0} value={draft} maxLength={3000} onChange={e=>{composerReveal.current?.cancel();editDraft(e.target.value);}} onBlur={()=>{if(chat&&!busy&&!pendingSend&&!draftRecovery.length&&draft!==savedDraft)persistDraft(chat.id,draft).catch(e=>setError(e.message));}}/>
   <div className="beta-composer-controls"><div className="beta-composer-options"><label><span className="beta-sr">{ui("Course")}</span><select aria-label={ui("Course")} value={chat?chat.course_id||'':pendingCourse} disabled={busy||draftRecovery.length>0||chatCreating} onChange={e=>chat?settings({course_id:e.target.value||null,context:[]}):editPending({course_id:e.target.value||null})}><option value="">{ui("All courses")}</option>{ws.courses.map(c=><option key={c.id} value={c.id}>{displayCourseLabel(c)}</option>)}</select></label><details className="nu-mode-menu"><summary>{(chat?.mode||pendingMode)==='ask'?ui("Options"):ui(({plan:"Plan",study:"Study",solve:"Solve",sources:"Find sources"} as Record<string,string>)[chat?.mode||pendingMode])}</summary><label><span>{ui("Assistant mode")}</span><select aria-label={ui("Assistant mode")} value={chat?.mode||pendingMode} disabled={busy||draftRecovery.length>0||chatCreating} onChange={e=>chat?settings({mode:e.target.value}):editPending({mode:e.target.value})}><option value="ask">{ui("Ask")}</option><option value="plan">{ui("Plan")}</option><option value="study">{ui("Study")}</option><option value="solve">{ui("Solve")}</option><option value="sources">{ui("Find sources")}</option></select></label></details></div><button aria-label={ui("Send message")} title={ui("Send message (Ctrl or Command + Enter)")} className="beta-send" disabled={sending}><ArrowUp size={20} aria-hidden="true"/></button></div>
  </form>
  {draftSaveError&&!pendingSend&&<p className="beta-answer-recovery" role="status">{ui(draftSaveError==='conflict'?'The saved draft changed. Your question is kept on this device; review both versions.':draftLocal?'Draft could not sync. Your question is kept on this device.':'Draft could not sync or be kept on this device. Copy your question before leaving.')} <button type="button" disabled={busy} onClick={draftSaveError==='conflict'?reloadDraft:retryDraft}>{ui(draftSaveError==='conflict'?'Review saved draft':'Retry draft save')}</button></p>}
  {!draftLocal&&!draftSaveError&&<p role="status">{ui('Browser recovery is unavailable. Keep this page open until your question is saved.')}</p>}
  <div hidden={compactComposer} className="beta-composer-caption"><small>{sendInFlight?ui("Sending…"):pendingSend?ui("Question kept · Check the saved request"):draftRecovery.length?ui("Draft review needed"):draft!==savedDraft?(draftSaveError?ui("Draft needs saving"):ui(draftLocal?"Draft kept on this device · Syncing…":"Saving draft…")):draft.trim()?ui("Draft saved"):(chat?.mode||pendingMode)==='sources'?ui("Searches your saved sources."):assistant==='ready'?ui("Answers use saved materials. Check the sources."):offline?ui("Assistant offline · Questions will queue."):ui("Assistant unavailable · Your draft is kept.")}</small><small id="beta-message-hint">{ui("Ctrl / ⌘ + Enter to send")}</small></div>
  <details className="nu-chat-tools"><summary>{ui("Sources and study sessions")}</summary><div>{deskCoverage}{studySessions.length>0&&!activeStudy&&<details className="nu-study-library"><summary>{ui("Study sessions (")}{studySessions.length})</summary>{[...new Set(studySessions.map(s=>s.courseId))].map(courseId=><section key={courseId||'all'}><h2>{courseId?courseLabel(courseId):ui("Across courses")}</h2>{studySessions.filter(s=>s.courseId===courseId).map(s=><div key={s.id}><div><strong>{s.question}</strong><small>{ui(studyApproaches[s.approach])} · {s.phase==='review'?ui("Review"):ui("In progress")}{s.goal?' · '+s.goal:''}</small></div><button disabled={busy} onClick={()=>void resumeStudy(s.id)}>{s.phase==='review'?ui("Open review"):ui("Resume")}</button></div>)}</section>)}</details>}</div></details>
  </>
 </div>{deskTask&&deskSource&&ws.planning&&<aside hidden={!showDesk} className="nu-assignment-desk" id="beta-assignment-desk" aria-labelledby="beta-assignment-desk-title" key={chat?.id+':'+deskTask.id}>
  <div className="nu-assignment-desk-header"><small>{ui('Assignment')}</small><button type="button" aria-label={ui('Close assignment panel')} onClick={()=>{setDeskCollapsed(true);requestAnimationFrame(()=>{const target=deskPlanButton.current;if(target?.isConnected)target.focus({preventScroll:true});else document.querySelector<HTMLButtonElement>('.nu-desk-context-chip')?.focus({preventScroll:true});});}}><X size={17} aria-hidden="true"/></button></div>
  <h2 id="beta-assignment-desk-title" tabIndex={-1} ref={deskPlanHeading}>{deskTitle}</h2>
  <p className="nu-desk-course">{courseLabel(deskTask.course_id)}</p>
  {pinnedVersion&&deskTask.id===pinnedAssignment?.id&&<button type="button" className="nu-desk-pinned" onClick={event=>void openSource({...deskSource,kind:'moodle',version_id:pinnedVersion},event.currentTarget)}>{ui('Open attached instructions')}</button>}
  <ProgressEditor desk suggestion={currentDeskSelection?.suggestion} task={deskTask} progress={ws.planning.progress.find(item=>item.task_id===deskTask.id)} report={ws.planning.activity_reports?.[deskTask.id]} status={now?workStatus(deskTask,ws.planning,now,actor.timezone):null} statusNow={now} groups={ws.planning.groups?.[deskTask.course_id]} sources={[deskSource]} zone={actor.timezone} onDirty={reportDeskDirty} onSave={savePlanning} onOpen={id=>openSource(ws.sources.find(s=>s.id===id)||{id} as Source)}/>
 </aside>}<div role="complementary" className="nu-chat-study" aria-label={ui("Study workspace")}>{activeStudy&&study&&<StudySessionPanel session={study} persistent={studyPersistent} response={studyResult?studyAnswer(studyResult):null} practiceQuestion={studyPractice?studyAnswer(studyPractice):null} busy={busy} pending={!!pendingSend||!!currentJob&&['queued','leased'].includes(currentJob.status)} onChange={updateStudy} onAsk={askStudy} onPause={()=>setStudyOpen(false)} onNote={saveStudyNote} onPlan={saveStudyPlan} onAnother={()=>{const origin=messages.find(m=>m.id===study!.originId);if(origin)beginStudy(origin,study!.approach,true);else setError('Load the earlier answer in Conversation before starting another session. Your saved review is kept.');}} courses={ws.courses} feedback={<><AssistantFeedback job={studyJob} sending={sendInFlight} assistant={assistant} now={now} onRefresh={checkAnswerStatus} refreshing={answerRefreshing}/>{!studyJob&&!sendInFlight&&<p>{currentJob&&['queued','leased'].includes(currentJob.status)?ui("Another question is waiting in this conversation. Your study request remains here."):ui("Your request is kept in this study session. Check the workspace message before trying again.")}</p>}{studyJob&&['leased','failed'].includes(studyJob.status)&&studyJob.draft&&<div><p>{ui("Unfinished draft. The final answer may change.")}</p><Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} skipHtml>{studyJob.draft}</Markdown></div>}</>}/>}</div></div>}
 {tab==='notes'&&<section className="beta-notebook">
  <ProductHeading title={ui("Your course notes")} description={ui("Class notes, study drafts and questions, organized by course.")}><button aria-expanded={addingCourse} aria-controls="beta-add-course" onClick={()=>setAddingCourse(!addingCourse)}><Plus size={18} aria-hidden="true"/>{ui("Add course")}</button></ProductHeading>
  {addingCourse&&<form id="beta-add-course" className="beta-add-course" onSubmit={e=>{e.preventDefault();run(async()=>{const c=await api('',{op:'course.create',code:courseCode.trim(),title:courseTitle.trim()});chooseNotebookCourse(c.id);setAddingCourse(false);setCourseCode('');setCourseTitle('');try{await refresh();}catch{setError('The course was added. Reload your vault to refresh the course list.');}});}}><label>{ui("Course code")}<input autoFocus name="course-code" autoComplete="off" required maxLength={40} value={courseCode} placeholder={ui("DEMO 1010")} onChange={e=>setCourseCode(e.target.value)}/></label><label>{ui("Course name")}<input name="course-title" autoComplete="off" required maxLength={180} value={courseTitle} placeholder={ui("Calculus")} onChange={e=>setCourseTitle(e.target.value)}/></label><div className="beta-form-actions"><button className="beta-primary" disabled={busy}>{ui("Add course")}</button><button type="button" disabled={busy} onClick={()=>setAddingCourse(false)}>{ui("Cancel")}</button></div></form>}
  <div className="beta-notebook-tools"><label>{ui('Note type')}<select aria-label={ui('Note type')} value={noteOrigin} onChange={e=>setNoteOrigin(e.target.value)}><option value="all">{ui('All loaded notes')}</option><option value="personal">{ui('My notes and imported originals')}</option><option value="practice">{ui('AI study drafts')}</option></select></label><label><span className="beta-sr">{ui("Notebook course")}</span><select ref={notebookCourse} name="notebook-course" value={course} disabled={busy} onChange={e=>chooseNotebookCourse(e.target.value)}><option value="">{ui("All courses")}</option>{ws.courses.map(c=><option key={c.id} value={c.id}>{displayCourseLabel(c)}</option>)}</select></label><button onClick={()=>addNote()} disabled={busy||!ws.courses.length}><Plus size={17} aria-hidden="true"/>{ui("New note")}</button></div>
  <div className="nu-note-starters" role="group" aria-label={ui('Note starters')}><span>{ui('Start with a purpose')}</span><button disabled={busy||!ws.courses.length} onClick={()=>addNote('prep')}>{ui('Prepare for class')}</button><button disabled={busy||!ws.courses.length} onClick={()=>addNote('review')}>{ui('Review a reading')}</button><button disabled={busy} onClick={()=>go('sources')}>{ui('Find supporting material')}</button></div>
  <div className="beta-notebook-grid"><aside className="beta-note-list" aria-label={ui("Saved notes")}><label className="beta-note-filter"><span className="beta-sr">{ui("Find a note by title")}</span><input type="search" name="note-filter" autoComplete="off" value={noteQuery} onChange={e=>setNoteQuery(e.target.value)} placeholder={ui("Find a note…")}/></label><small role="status">{filteredNotes.length} {filteredNotes.length===1?ui("note"):ui("notes")}  {ui("shown")}</small>{filteredNotes.map(n=><button className={note?.id===n.id?'selected':''} aria-current={note?.id===n.id?'true':undefined} key={n.id} onClick={()=>selectNote(n)}><strong>{n.title}</strong><small>{courseLabel(n.course_id)}{n.origin==='ai_draft'?ui("· AI study draft"):''}</small></button>)}{!filteredNotes.length&&<WorkspaceState compact kind={noteQuery.trim()||noteOrigin!=='all'?"search":"notes"} title={ui(noteQuery.trim()?"No loaded notes match this title.":noteOrigin!=='all'?"No loaded notes match this type.":"No notes here yet.")} description={noteQuery.trim()?ui("Try another title, or clear the filter."):noteOrigin!=='all'?ui("Choose another note type or load more notes. This filter only checks notes already loaded."):course?(ws.notes.length>=listLimit?ui("No loaded notes in this course. Load more notes to check."):ui("No notes in this course yet.")):ui("Your saved class notes will appear here.")} actionLabel={noteQuery.trim()?ui("Clear filter"):undefined} onAction={noteQuery.trim()?()=>setNoteQuery(''):undefined}/>}{ws.notes.length>=listLimit&&listLimit<1000&&<button disabled={busy} onClick={loadMore}>{ui("Load more notes")}</button>}</aside>
  {note?<div className="beta-note-editor"><p className="beta-editor-status" role="status">{courseLabel(note.course_id)} · {note.origin==='ai_draft'?ui("AI study draft ·"):''}{dirty?ui("Unsaved changes"):ui("Saved")}</p><EvidenceChange sources={note.changed_sources} onOpen={(s,trigger)=>openSource(s,trigger)}/><textarea ref={noteTitleInput} className="beta-note-title" rows={2} name="note-title" autoComplete="off" aria-label={ui("Note title")} maxLength={180} value={note.title} onChange={e=>editNote('title',e.target.value)}/><textarea name="note-body" aria-label={ui("Note contents")} value={note.body} maxLength={80000} placeholder={ui("Write your notes here…")} onChange={e=>editNote('body',e.target.value)}/><div className="beta-note-actions"><button className="beta-primary" disabled={busy||!dirty} onClick={saveNote}>{busy?ui("Saving…"):ui("Save note")}</button><button disabled={busy} onClick={()=>openSource({id:note.source_id,course_id:note.course_id,title:note.title,kind:note.origin==='ai_draft'?'ai_draft':'note'})}>{ui("Open source")}</button><button disabled={busy||dirty||note.origin==='ai_draft'} onClick={()=>run(()=>useInChat({id:note.source_id,course_id:note.course_id,title:note.title,kind:'note'}))}>{ui("Ask about this note")}</button></div>{noteConflict&&<section role="alert"><p>{ui("This note changed elsewhere. Your draft is preserved.")}</p><button disabled={busy} onClick={preserveConflictCopy}>{ui("Save my draft as a copy")}</button><details><summary>{ui("Review the other version")}</summary><pre>{noteConflict.body}</pre></details></section>}</div>:<WorkspaceState kind="notes" title={ui("Your notes, ready when you are")} description={ui("Open a saved note, or choose a course and create a new one.")} actionLabel={ui(filteredNotes.length>0?"Open your latest note":course?"New note":"Choose a course")} disabled={busy} onAction={()=>{if(filteredNotes.length>0)void selectNote(filteredNotes[0]);else if(course)void addNote();else notebookCourse.current?.focus();}}/>}
  </div></section>}
 {tab==='updates'&&<MaterialUpdates local={local} busy={busy} refreshing={updatesRefreshing} refreshError={ui(updatesError)} onRefresh={()=>{if(!busy&&!updatesRefreshing)void refreshUpdates();}} changes={ws.changes} courseLabel={courseLabel} timezone={actor.timezone} onOpen={change=>openSource({id:change.source_id,course_id:change.course_id,title:change.title,kind:change.kind,version_id:change.version_id})}/> }
 {captureEnabled&&(captureVisited||tab==='classes')&&<div style={{display:tab==='classes'?undefined:'none'}}><ClassRecordings user={actor.id} courses={ws.courses} materials={ws.sources} currentCourseIds={ws.planning?.current_course_ids} visible={tab==='classes'} onActivityChange={setCaptureActive} onVaultChange={refresh} onSource={id=>openSource({id} as Source)} onMaterial={ref=>openSource({id:ref.source_id,version_id:ref.version_id} as Source)} onNote={id=>void openCornellNote(id)} onPlan={()=>go('today')} requested={requestedRecording}/></div>}
 {<section className="beta-library" hidden={tab!=='sources'}>{setupFiles&&<p><button type="button" disabled={uploadActive} onClick={()=>{go('setup');setSetupFiles(false);}}>{ui('Back to guided setup')}</button></p>}<ProductHeading title={ui("Your course materials")} description={ui("Open saved originals, find supporting text and check collection gaps.")}><button disabled={busy} onClick={showImport}>{ui("Add files")}</button></ProductHeading><div className="nu-source-views" role="group" aria-label={ui('Source view')}><button aria-pressed={sourceView==='coursework'} onClick={()=>setSourceView('coursework')}>{ui('Upcoming coursework')}</button><button aria-pressed={sourceView==='all'} onClick={()=>setSourceView('all')}>{ui('All saved material')}</button></div><div className="nu-library-tools" data-view={sourceView}><label className="beta-source-course">{ui("Course")} <select aria-label={ui("Filter source course")} value={course} disabled={busy} onChange={e=>changeLibraryCourse(e.target.value)}><option value="">{ui("All courses")}</option>{ws.courses.map(c=><option key={c.id} value={c.id}>{displayCourseLabel(c)}</option>)}</select></label><form className="beta-search" style={{display:sourceView==='all'?undefined:'none'}} onSubmit={e=>{e.preventDefault();searchSources();}}><Search size={18} aria-hidden="true"/><input ref={sourceSearchInput} name="source-search" type="search" maxLength={200} autoComplete="off" aria-label={ui("Search sources")} value={query} onChange={e=>setQuery(e.target.value)} placeholder={ui("Search your course materials")}/><button disabled={busy}>{searching?ui("Searching…"):ui("Search")}</button>{query&&<button type="button" aria-label={ui("Clear search")} onClick={clearSourceSearch}><X size={16} aria-hidden="true"/></button>}</form></div>{sourceView==='coursework'&&<CourseworkSources visible={tab==='sources'} course={course} tasks={ws.tasks} planning={ws.planning} assessmentRead={assessmentRead} now={now} zone={actor.timezone} refreshKey={(ws.sources[0]?.version_id||'')+ws.sources.length} courseLabel={courseLabel} onOpen={(ref,trigger)=>openSource(ref,trigger)} onBrowse={()=>setSourceView('all')} onWeek={()=>go('today')}/>}<div hidden={sourceView!=='all'}>{searching?<ActivityStatus label="Searching your saved sources…" detail="Checking all saved material for these filters."/>:searchError?<WorkspaceState compact kind="error" announce title={ui("Search could not finish.")} description={ui(searchError)} actionLabel={ui("Try again")} onAction={library.retry} disabled={busy}/>:searchText&&!searchCurrent?<p className="beta-search-status" role="status">{ui("Choose Search to see results for this query.")}</p>:null}{searchedQuery!==null&&!searching&&<p className="nu-search-caption" role="status">{ui("Results for “{query}”",{query:searchedQuery})} · {sourceTotal} {sourceTotal===1?ui("source found"):ui("sources found")}</p>}<div className="nu-source-filters" role="group" aria-label={ui('Material types')}>{[['','All material'],['moodle','Moodle pages'],['file','Documents'],['note','Notes and working material']].map(([kind,label])=><button key={kind} aria-pressed={sourceKind===kind} onClick={()=>setSourceKind(kind)}>{ui(label)}</button>)}</div><details ref={importDisclosure} className="beta-import-disclosure nu-library-import" open={importOpen} onToggle={event=>setImportOpen(event.currentTarget.open)}><summary>{ui("Add files or a folder")}</summary><SourceUpload courses={ws.courses} defaultCourse={course} readableCopy={readableCopy} onSaved={savedCourseFile} onOpen={openSource} onActivityChange={setUploadActive}/></details><div className="nu-material-heading"><h2>{ui(searchedQuery!==null?'Search results':'Saved material')}</h2><span>{library.data?<>{sourceTotal} {ui(sourceTotal===1?'saved source':'saved sources')}</>:ui(searchError?'Material list unavailable':'Loading materials…')}</span></div><div ref={sourceList} className="beta-source-list" aria-busy={searching||undefined}>{pageSources.map(s=><button key={s.id} disabled={busy} data-beta-source={s.id} data-beta-version={s.version_id} onClick={e=>openSource(s,e.currentTarget)}><FileText size={20} aria-hidden="true"/><span><strong>{s.title}</strong><small>{courseLabel(s.course_id)} · {s.kind==='note'?ui("Notes and working material"):s.kind==='moodle'?ui("Moodle"):s.kind==='ai_draft'?ui("AI study draft"):ui("File")}{s.observed_at&&Number.isFinite(Date.parse(s.observed_at))&&<time dateTime={s.observed_at}>{ui("Saved")} {new Intl.DateTimeFormat(locale,{timeZone:actor.timezone,dateStyle:"medium"}).format(new Date(s.observed_at))}</time>}</small></span><span aria-hidden="true">↗</span></button>)}{!!library.data&&!pageSources.length&&safePage>0&&!searching&&!searchError&&<WorkspaceState kind="sources" title={ui("Saved materials changed")} description={ui("Return to the first page to see the current materials for these filters.")} actionLabel={ui("First page")} onAction={library.reload}/>}
{!sourceTotal&&!!library.data&&safePage===0&&!searching&&!searchError&&<WorkspaceState kind={searchedQuery!==null||sourceKind?"search":"sources"} title={ui(searchedQuery!==null?"No matching sources.":sourceKind?"No materials match this filter.":"Your course materials start here.")} description={ui(searchedQuery!==null?"Try another search, or return to your saved materials.":sourceKind?"Choose another material type to see more of your saved sources.":"Add a file or folder, or collect material with your connected Companion.")} actionLabel={ui(searchedQuery!==null?"Clear search":sourceKind?"Show all material":"Add files or a folder")} onAction={searchedQuery!==null?clearSourceSearch:sourceKind?()=>setSourceKind(''):showImport} disabled={busy}/>}</div><nav className="beta-source-pages" aria-label={ui("Source pages")}><button disabled={searching||safePage===0} onClick={()=>{focusSourcePage.current=true;library.previous();}}>{ui("Previous")}</button><span>{library.data?<>{ui("Page")} {safePage+1} {ui("of")} {Math.max(safePage+1,pageCount)} · {sourceTotal} {searchedQuery!==null?ui(sourceTotal===1?"match":"matches"):ui(sourceTotal===1?"saved source":"saved sources")}</>:ui(searchError?'Material list unavailable':'Loading materials…')}</span><button disabled={searching||!library.data?.next_cursor} onClick={()=>{focusSourcePage.current=true;library.next();}}>{ui("Next")}</button></nav><button disabled={searching} onClick={library.reload}>{ui("Refresh materials")}</button><details className="beta-source-readiness"><summary>{ui("Reading status")}{ws.reading?' · '+ws.reading.total+' '+ui("sources in reading scope"):''}</summary><MaterialReading reading={ws.reading} offline={assistant!=='ready'}/>{!local&&ws.coverage?.length>0&&<CourseReadinessPanel coverage={ws.coverage.filter(c=>!course||c.course_id===course)} title={courseLabel}/>}</details>{ws.jobs.some(j=>j.kind==='extract'&&['queued','leased','failed'].includes(j.status))&&<section className="beta-extraction-progress" aria-label={ui("Document reading status")}><strong>{ws.jobs.filter(j=>j.kind==='extract'&&['queued','leased'].includes(j.status)).length}  {ui("documents waiting or reading")}</strong><p>{ui("Saved originals remain available while text is read. Visual content and equations may need review.")}</p>{ws.jobs.filter(j=>j.kind==='extract'&&j.status==='failed').slice(0,3).map(j=><div key={j.id}><strong>{j.source_title||ui('Document needing review')}</strong><p>{j.error||ui("A document could not be read. Open its original to review the content.")}</p>{j.source_id&&<button disabled={busy} onClick={()=>openSource({id:j.source_id!} as Source)}>{ui('Review original and reading gaps')}</button>}</div>)}</section>}{!local&&course&&<details className="beta-source-readiness" open={courseContextOpen} onToggle={e=>setCourseContextOpen(e.currentTarget.open)}><summary>{ui("Groups and course details")}</summary>{courseContextOpen&&tab==='sources'&&sourceView==='all'&&<CourseContextPanel onSaved={()=>{void refresh().catch(()=>setError('Your group is saved. Reload Neyvu to refresh assignment details.'));}} courseId={course} courses={ws.courses.map(c=>({...c,code:displayCourseLabel(c)}))} disabled={busy} refreshKey={ws.sources[0]?.version_id} onOpen={ref=>openSource({id:ref.source_id,version_id:ref.version_id} as Source)}/>}</details>}</div></section>}
 <div style={{display:tab==='today'?undefined:'none'}}>{ws.planning&&<StudentPlanner assessmentRead={assessmentRead} onCalendar={()=>go('calendar')} meetings={ws.meetings} onSelectTask={plannerTask} planning={ws.planning} tasks={ws.tasks} courses={ws.courses} sources={ws.sources} now={now} zone={actor.timezone} onDirtyChange={setPlannerDirty} onVersion={ref=>openSource({id:ref.source_id,version_id:ref.version_id} as Source)} onRecording={captureEnabled?openClassAction:undefined} onOpen={id=>openSource(ws.sources.find(s=>s.id===id)||{id} as Source)} coverage={tab==='today'?(showTodayCoverage?todayCoverage:deskCoverage):undefined} coverageAtTop={showTodayCoverage} composer={<TodayAsk question={todayQuestion} setQuestion={setTodayQuestion} course={todayQuestionCourse} setCourse={setTodayQuestionCourse} courses={ws.courses} disabled={busy||chatCreating||!!pendingSend} onAsk={(question,courseId)=>newChat({courseId:courseId||null,question,sendNow:true})} onChat={()=>go('chat')} onSetup={!actor.demo&&!local?()=>go('setup'):undefined}/>} onAskTask={task=>void newChat({courseId:task.course_id,task})} onSave={savePlanning}/>}<details className="nu-today-assessments"><summary>{ui("Tests and classwork from your sources")}</summary><AssessmentClaims read={assessmentRead} courseIds={ws.planning?.current_course_ids} zone={actor.timezone} onVersion={ref=>openSource({id:ref.source_id,version_id:ref.version_id} as Source)}/></details></div>
 {tab==='calendar'&&<section className="beta-calendar"><ProductHeading title={ui("Calendar")} description={ui("Your month at a glance. Select a day to see its work and saved details.")}/>{now&&<BetaCalendar sources={ws.sources} onSave={savePlanning} onDirty={reportDeskDirty} onProject={id=>{if(plannerDirty){setError('Save or reload your current Today edits before opening another plan.');return;}setPlannerTask({id,kind:'plan',request:Date.now()});go('today');}} onPlan={id=>{if(plannerDirty){setError('Save or reload your current Today edits before opening another study plan.');return;}setPlannerTask({id,request:Date.now()});go('today');}} onVersion={ref=>openSource({id:ref.source_id,version_id:ref.version_id} as Source)} busy={busy} tasks={ws.planning?ws.tasks.filter(t=>ws.planning!.current_course_ids.includes(t.course_id)):ws.tasks} planning={ws.planning} meetings={ws.planning?ws.meetings.filter(m=>ws.planning!.current_course_ids.includes(m.course_id)):ws.meetings} courses={ws.courses} zone={actor.timezone} now={now} onOpen={id=>openSource(ws.sources.find(s=>s.id===id)||{id} as Source)}/>}<details className="nu-calendar-management" ref={element=>{if(element&&openScheduleReview.current){openScheduleReview.current=false;element.open=true;if(!scheduleCourse)requestAnimationFrame(()=>element.querySelector('summary')?.focus());}}}><summary>{ui("Manage class times")}</summary>{scheduleCourse&&scheduleForm}{!local&&<TimetableSuggestions refreshKey={ws.sources[0]?.version_id} disabled={busy||scheduleDirty} onDirtyChange={setScheduleDirty} onOpen={ref=>openSource({id:ref.source_id,version_id:ref.version_id} as Source)} onSave={async(source_id,schedule)=>{await api('',{op:'meeting.create',source_id,schedule});await refresh();}}/>}{!local&&<details className="nu-calendar-context"><summary>{ui('Find class times and office hours in your sources')}</summary><CourseContextPanel onSaved={()=>{void refresh().catch(()=>setError('Your group is saved. Reload Neyvu to refresh assignment details.'));}} onSources={()=>go('sources')} courseId={contextCourse} courses={ws.courses.filter(c=>!ws.planning||ws.planning.current_course_ids.includes(c.id)).map(c=>({...c,code:displayCourseLabel(c)}))} onCourse={setContextCourse} disabled={busy} refreshKey={ws.sources[0]?.version_id} onOpen={ref=>openSource({id:ref.source_id,version_id:ref.version_id} as Source)}/></details>}{ws.meetings.length>0&&<details><summary>{ui("Review saved meetings")}</summary>{ws.meetings.map(m=><div key={m.id}><strong>{String(m.schedule?.title||'Class')}</strong><p>{String(m.schedule?.authority||'Saved schedule')} · {String(m.schedule?.start_time||'')}–{String(m.schedule?.end_time||'')}  {ui("Halifax time")}{m.schedule?.active===false?ui("· Removed from calendar"):''}</p><button disabled={busy||scheduleDirty} onClick={()=>run(async()=>{await api('',{op:'meeting.set_active',meeting_id:m.id,active:m.schedule?.active===false});setNotice(m.schedule?.active===false?'Class schedule restored.':'Class schedule removed from the calendar. You can restore it here.');await refresh();})}>{m.schedule?.active===false?ui("Restore to calendar"):ui("Remove from calendar")}</button></div>)}</details>}{!scheduleCourse&&scheduleForm}</details>{!local&&<details className="nu-calendar-management"><summary>{ui('Connection and setup')}</summary><MoodleFreshness coverage={ws.coverage} scope={course?[course]:ws.planning?.current_course_ids} now={now} timezone={actor.timezone} onConnect={()=>go('connection')}/>{!actor.demo&&<Onboarding showCompleted revision={ws.courses.length+':'+ws.sources.length+':'+ws.notes.length+':'+messages.length} onNavigate={next=>go(next)}/>}</details>}</section>}
 </>}
 </main></div>{source&&<SourcePanel panel={dialog} label={source.title} width={sourceWidth} onResize={setSourceWidth} onClose={closeSource}>
  <header className="beta-source-header"><button autoFocus onClick={closeSource}><ArrowLeft size={18} aria-hidden="true"/>{ui("Back")}</button><h2>{source.title}</h2><small>{courseLabel(source.course_id)}{source.observed_at&&Number.isFinite(Date.parse(source.observed_at))?ui("· Saved")+' '+new Intl.DateTimeFormat(locale,{timeZone:actor.timezone,dateStyle:'medium'}).format(new Date(source.observed_at)):''}</small>{source.content&&<SourceLimitations content={source.content}/>}<div className="beta-source-actions">{source.mime==='application/pdf'&&source.content?.state==='no_text'&&<button type="button" className="beta-primary" disabled={busy||uploadActive} onClick={()=>addReadableCopy(source.course_id)}>{ui('Add a readable copy')}</button>}<button disabled={busy||source.kind==='ai_draft'} onClick={()=>run(()=>useInChat(source))}>{ui("Ask about this source")}</button>{source.kind==='moodle'&&moodleActivityLink(source.original_url)&&<a target="_blank" rel="noreferrer" href={moodleActivityLink(source.original_url)}>{ui("Open current Moodle activity")}</a>}{source.object_key&&source.mime==='application/pdf'&&<a target="_blank" rel="noreferrer" href={'/api/beta/files?id='+source.id+(source.version_id?'&version='+source.version_id:'')+'&view=1'+pageFragment(source.body,sourceExcerpt)}>{ui("View original PDF")}</a>}{source.object_key&&<a className="beta-download" href={'/api/beta/files?id='+source.id+(source.version_id?'&version='+source.version_id:'')}>{ui("Download original")}</a>}</div>{(error||notice)&&<div className={error?'beta-alert':'beta-notice'} role={error?'alert':'status'}>{ui(error||notice)}{error&&<button aria-label={ui("Dismiss source message")} onClick={()=>setError('')}><X size={16} aria-hidden="true"/></button>}</div>}</header>
  <SourcePassage excerpt={sourceExcerpt} body={source.body||(source.object_key?ui("The original is saved. Check document reading status in Sources."):ui("No readable text was saved for this source."))}/>
  {source.capture&&<details><summary>{ui("Collection details")}</summary><p>{ui("Last page check:")} {new Date(source.capture.captured_at).toLocaleString(locale)}{ui(". This records the latest capture of the page; the text version shown has its own date above.")}</p><ul>{source.capture.coverage.issues.map((issue,i)=><li key={i}>{issue}</li>)}</ul></details>}
  {source.kind!=='ai_draft'&&<section className="nu-source-study" aria-label={ui('Study this source')}><h3>{ui('Make sense of this material')}</h3><p>{ui('Prepare a question tied to this exact source version. Review the question before sending; answers remain drafts to check against the original.')}</p><div className="beta-form-actions">{[['Explain the argument','Explain the main argument in the selected source, the reasons and evidence, important distinctions, and its limits. Cite exact pages or slides from the available text. Separate source claims, your interpretation and any AI-written illustrative example. Say which parts of the material are missing from your context.'],['Prepare for class','Prepare me to discuss the selected source in class: its main argument, important examples, connections to the course, tensions, and two discussion contributions with likely follow-up questions. Cite the available passages and distinguish interpretation from quotations. Do not invent class requirements or dates.'],['Understand the requirements','Explain exactly what this selected source asks me to do: deliverables, criteria, conditions, exceptions, and uncertainties. Cite the saved wording. Separate explicit requirements from optional advice; do not infer dates, submission status or permission.']].map(([label,prompt])=><button key={label} disabled={busy||!!draft.trim()||source.content?.state==='no_text'} onClick={()=>run(()=>useInChat(source,ui(prompt)))}>{ui(label)}</button>)}</div>{source.content?.state==='no_text'&&<p>{ui('Readable source text is needed before preparing this review. Check the original and reading gaps first.')}</p>}{draft.trim()&&<p>{ui('Your current question is kept. Finish it or clear it before preparing a source review.')}</p>}</section>}
  {source.content&&<SourceGuide content={source.content}/>}
  {source.version_id&&source.kind!=='ai_draft'&&<SourceProfile key={source.id+':'+source.version_id} id={source.id} version={source.version_id}/>}
 </SourcePanel>}{memoryTrigger&&<MemoryManager actor={actor.id} chat={chat?.id||null} course={chat?chat.course_id:pendingCourse||null} courses={ws.courses} trigger={memoryTrigger} onClose={()=>setMemoryTrigger(null)}/>}<WorkspaceNavigation mobile tab={tab} local={local} captureEnabled={captureEnabled} unseenUpdates={unseenUpdates} href={workspaceHref} onNavigate={(e,key)=>{if(ordinaryClick(e)){e.preventDefault();go(key);}}}/></div>;
}
