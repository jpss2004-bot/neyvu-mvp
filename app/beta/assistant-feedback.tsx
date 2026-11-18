'use client';
import {useState} from 'react';
import ActivityStatus from './activity-status';
import {useI18n} from "./language";

export function WorkspaceOpening(){
 return <section className="nu-opening-inline" aria-busy="true"><ActivityStatus label="Opening Neyvu…" detail="Loading your saved courses, conversations and notes." pausable/></section>;
}

export type AssistantAvailability = 'ready' | 'offline' | 'disabled';

export type AssistantFeedbackJob = {
 activity?:{label:string;source_title?:string;course?:string}|null;
 id: string;
 status: string;
 recovering?:boolean;
 error?: string | null;
 draft?: string | null;
 updated_at?: string | null;
};

export type AssistantFeedbackProps = {
 job?: AssistantFeedbackJob | null;
 onEditQuestion?:()=>void;
 onOpenMaterials?:()=>void;
 onOpenNotebook?:()=>void;
 sending?: boolean;
 assistant: AssistantAvailability;
 now?: Date | null;
 onRefresh?: () => void;
 refreshing?: boolean;
 refreshError?: string;
};

export type AssistantFeedbackState = {
 state: 'sending' | 'queued' | 'running' | 'draft' | 'offline' | 'disabled' | 'failed';
 title: string;
 detail: string;
 pending: boolean;
 animated: boolean;
 delayed: boolean;
 updatedAt: string | null;
 lastUpdate: string | null;
};

// updated_at marks the last saved job change, not the start of the question.
// Missing or future timestamps cannot establish how long the answer has waited.
function updateAge(updatedAt: string | null | undefined, now: Date | null | undefined) {
 if (!updatedAt || !now) return null;
 const updated = Date.parse(updatedAt), current = now.getTime();
 if (!Number.isFinite(updated) || !Number.isFinite(current) || updated > current) return null;
 return Math.floor((current - updated) / 1000);
}

function elapsedLabel(seconds: number) {
 if (seconds < 60) return `${seconds}s ago`;
 if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
 if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
 const days = Math.floor(seconds / 86400);
 return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

export function assistantFeedbackState(
 job: AssistantFeedbackJob | null | undefined,
 assistant: AssistantAvailability,
 now?: Date | null,
 sending = false,
): AssistantFeedbackState | null {
 if (sending) return {
  state: 'sending', title: 'Sending your question',
  detail: 'Waiting for your vault to confirm it was saved.',
  pending: true, animated: true, delayed: false, updatedAt: null, lastUpdate: null,
 };
 if (!job || !['queued', 'leased', 'failed','cancelled'].includes(job.status)) return null;
 if(job.status==='cancelled'&&!job.error?.trim())return null;
 const age = updateAge(job.updated_at, now);
 const pending = !['failed','cancelled'].includes(job.status);
 const timing = {
  pending,
  delayed: pending && age !== null && age >= 45,
  updatedAt: age === null ? null : job.updated_at!,
  lastUpdate: age === null ? null : `Last update ${elapsedLabel(age)}`,
 };
 if (job.status === 'failed'||job.status==='cancelled') return {
  ...timing, state: 'failed', title: 'This answer could not finish',
  detail: job.error?.trim() || 'Your question is kept in this chat. You can edit and send it again.',
  animated: false,
 };
 if (assistant === 'disabled') return {
  ...timing, state: 'disabled', title: 'Assistant unavailable',
  detail: 'Your saved question is still pending. Your notes and sources are available.',
  animated: false,
 };
 if(job.recovering&&job.status==='queued')return {...timing,state:'queued',title:'Reconnecting the assistant',detail:'Your question is saved. Neyvu will retry automatically after the local model is ready.',animated:true};
 if (assistant === 'offline') return {
  ...timing, state: 'offline',
  title: job.status === 'queued' ? 'Question saved for later' : 'Assistant connection interrupted',
  detail: job.status === 'queued'
   ? 'The assistant is offline. Your question will wait here until it returns.'
   : 'The assistant is not checking in. Your question is kept here; check status for an update.',
  animated: false,
 };
 if (job.status === 'queued') return {
  ...timing, state: 'queued', title: 'Question saved',
  detail: timing.delayed
   ? 'Your question is still waiting for the assistant. You can keep using your vault.'
   : 'Waiting for the assistant to start. You can keep using your vault.',
  animated: false,
 };
 if (job.draft?.trim()) return {
  ...timing, state: 'draft', title: 'Draft available',
  detail: timing.delayed
   ? 'The final answer is still pending. This unfinished draft may change.'
   : 'This draft is unfinished. The final answer may change.',
  animated: true,
 };
 return {
  ...timing, state: 'running',
  title: timing.delayed ? 'Still waiting for your answer' : 'Preparing your answer',
  detail: timing.delayed
   ? 'There has not been another saved update yet. Check status for the latest answer.'
   : 'The assistant has started your question. Your answer will appear here.',
  animated: true,
 };
}

export default function AssistantFeedback({job,sending=false,assistant,now,onRefresh,refreshing=false,refreshError,onEditQuestion}:AssistantFeedbackProps){
 const {t:ui}=useI18n();const [motionPaused,setMotionPaused]=useState(false);
 const feedback=assistantFeedbackState(job?.status==='leased'?{...job,draft:null}:job,assistant,now,sending);
 if(!feedback)return null;
 const canCheck=!sending&&feedback.pending&&(feedback.delayed||assistant!=='ready')&&!!onRefresh;
 const saved=!sending&&!!job,started=saved&&job?.status==='leased',draftAvailable=started&&!!job?.draft?.trim();
 const needsAttention=['failed','offline','disabled'].includes(feedback.state);
 return <div className="beta-assistant-feedback nu-compact-feedback" data-state={feedback.state} data-active={feedback.animated||undefined} data-motion-paused={motionPaused||undefined}>
  <span className="nu-chat-status-dot" aria-hidden="true"/>
  <div className="nu-inline-feedback-copy">
   <div role="status" aria-live="polite" aria-atomic="true"><strong>{ui(feedback.state==='running'&&job?.activity?.label?job.activity.label:feedback.title)}</strong>{feedback.state==='running'&&job?.activity?.source_title&&<span className="nu-reading-activity"> · {job.activity.source_title}</span>}{needsAttention&&<p>{ui(feedback.detail)}</p>}</div>{feedback.lastUpdate&&<time dateTime={feedback.updatedAt!}>{ui('Last update {age}',{age:ui(elapsedLabel(updateAge(job?.updated_at,now)??0))})}</time>}
   {feedback.state==='failed'&&<p>{ui('Your question is kept in this chat. You can edit and send it again below.')}</p>}
   {feedback.state==='failed'&&onEditQuestion&&<button onClick={onEditQuestion}>{ui('Edit saved question')}</button>}
   {canCheck&&<button type="button" onClick={onRefresh} disabled={refreshing}>{refreshing?ui('Checking status…'):ui('Check status')}</button>}
   {refreshError&&<p role="alert">{ui(refreshError)}</p>}
   {feedback.pending&&<details className="nu-feedback-details"><summary>{ui('Details')}</summary>{!needsAttention&&<p>{ui(feedback.detail)}</p>}
    <ul><li>{ui(saved?'Question saved':'Saving question')}</li><li>{ui(started?'Assistant started':'Waiting to start')}</li><li>{ui(draftAvailable?'Draft available':'Draft pending')}</li><li>{ui('Answer pending')}</li></ul>
    {feedback.animated&&<button type="button" aria-pressed={motionPaused} onClick={()=>setMotionPaused(value=>!value)}>{motionPaused?ui('Resume activity animation'):ui('Pause activity animation')}</button>}
   </details>}
  </div>
 </div>;
}
