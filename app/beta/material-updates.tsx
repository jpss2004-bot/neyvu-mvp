'use client';
import {useI18n} from "./language";

import {useState} from 'react';
import {ChevronRight,FileText} from 'lucide-react';

export type MaterialChange={source_id:string;course_id:string;title:string;kind:'moodle'|'file';original_url:string|null;version_id:string;sha256:string;observed_at:string;change:'first_saved'|'changed'};

export default function MaterialUpdates({changes,courseLabel,onOpen,timezone,local=false,busy=false,refreshing=false,refreshError='',onRefresh}:{
 changes:MaterialChange[];
 courseLabel:(courseId:string)=>string;
 onOpen:(change:MaterialChange)=>void;
 timezone:string;
 local?:boolean;
 busy?:boolean;
 refreshing?:boolean;
 refreshError?:string;
 onRefresh?:()=>void;
}){
 const {t:ui,locale}=useI18n();
 const [course,setCourse]=useState(''),[kind,setKind]=useState(''),[allVersions,setAllVersions]=useState(false);
 const courseIds=[...new Set(changes.map(change=>change.course_id))];
 const matching=changes.filter(change=>(!course||change.course_id===course)&&(!kind||change.kind===kind));
 const seen=new Set<string>();
 const visible=matching.filter(change=>{if(allVersions)return true;if(seen.has(change.source_id))return false;seen.add(change.source_id);return true;});
 const formatter=new Intl.DateTimeFormat(locale,{timeZone:timezone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
 const when=(value:string)=>Number.isFinite(Date.parse(value))?formatter.format(new Date(value)):'Saved time unavailable';
 return <section className="beta-library" aria-label={ui("Material updates")} aria-busy={refreshing}>
  <div className="beta-section-head"><div><h1>{ui("Material updates")}</h1><p>{ui("New and changed pages and files saved during the last 14 days.")}</p></div>{onRefresh&&<button type="button" disabled={busy||refreshing} onClick={onRefresh}>{refreshing?ui("Refreshing updates…"):ui("Refresh updates")}</button>}</div>
  {refreshError&&<p className="beta-alert" role="alert">{refreshError}</p>}
  <p className="beta-change-explainer">{ui("A saved time shows when Neyvu saved a page or file. It does not establish when your instructor posted it. Check Moodle for current instructions, deadlines, receipts and grades.")}</p>
  {changes.length>0&&<div className="nu-update-filters"><label>{ui('Course')}<select aria-label={ui('Updates course')} value={course} onChange={e=>setCourse(e.target.value)}><option value="">{ui('All courses')}</option>{courseIds.map(id=><option key={id} value={id}>{courseLabel(id)}</option>)}</select></label><label>{ui('Material type')}<select aria-label={ui('Updates material type')} value={kind} onChange={e=>setKind(e.target.value)}><option value="">{ui('All material')}</option><option value="moodle">{ui('Moodle pages')}</option><option value="file">{ui('Documents')}</option></select></label><label className="beta-check-label"><input type="checkbox" checked={allVersions} onChange={e=>setAllVersions(e.target.checked)}/>{ui('Show every saved version')}</label></div>}
  {changes.length>0&&<p className="beta-update-summary">{visible.length} {ui("shown")} · {allVersions?ui("All matching versions"):ui("Latest saved version per material")}{ui(". Select one to read that exact version.")}</p>}
  <div className="beta-source-list">{visible.map(change=><button type="button" key={change.version_id} disabled={busy} aria-label={ui("Open")+' '+(change.change==='changed'?ui("changed"):ui("first saved"))+' '+ui("version of")+' '+(change.title||ui("Untitled material"))+', '+courseLabel(change.course_id)+', '+when(change.observed_at)} onClick={()=>onOpen(change)}>
   <FileText size={20} aria-hidden="true"/><span><strong>{change.title||ui("Untitled material")}</strong><small>{courseLabel(change.course_id)} · {change.kind==='moodle'?ui("Moodle page"):ui("Saved file")} · {change.change==='changed'?ui("Changed saved version"):ui("First saved version")}</small><small>{Number.isFinite(Date.parse(change.observed_at))?<>{ui("Saved")} <time dateTime={change.observed_at}>{when(change.observed_at)}</time></>:when(change.observed_at)}</small></span><ChevronRight className="beta-source-action" size={16} aria-hidden="true"/>
  </button>)}{changes.length>0&&!visible.length&&<p role="status">{ui("No recent versions match these filters.")}</p>}{!changes.length&&<div className="beta-empty"><h2>{ui("No recent saved versions")}</h2><p>{ui("No Moodle page or file versions were saved in the last 14 days.")} {local?ui("Refresh your personal vault to check for newer saved material, or add a file in Sources."):ui("Keep Companion and its Moodle window open for Moodle checks, or add a file in Sources.")}</p><a className="beta-primary" href={'/beta?tab='+(local?'connection':'sources')}>{local?ui("Open personal vault"):ui("Open sources")}</a></div>}</div>
  <small>{ui("This view shows up to 40 recent versions. Notes and AI study drafts are in the course notebook.")}</small>
 </section>;
}
