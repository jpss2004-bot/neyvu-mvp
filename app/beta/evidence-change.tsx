'use client';
import {useI18n} from "./language";
import type {ChangedSource} from '../../lib/beta/source-dependencies';
export default function EvidenceChange({sources,onOpen}:{sources?:ChangedSource[];onOpen:(source:{id:string;title:string;course_id:string;kind:string;version_id:string},trigger:HTMLElement)=>void}){
 const {t:ui}=useI18n();
 if(!sources?.length)return null;
 return <aside className="beta-evidence-change" aria-label={ui("Changed source evidence")}>
  <p><strong>{ui("Source changed.")}</strong>  {ui("Check the current wording before relying on this saved work.")}</p>
  <details><summary>{ui("Compare saved versions (")}{sources.length})</summary><p>{ui("Your saved work and cited versions are preserved.")}</p>{sources.map(source=><div key={source.id+source.version_id}><strong>{source.title}</strong><div className="beta-profile-actions"><button type="button" onClick={e=>onOpen({...source,version_id:source.current_version},e.currentTarget)}>{ui("Open current source")}</button><button type="button" onClick={e=>onOpen(source,e.currentTarget)}>{ui("Open cited version")}</button></div></div>)}</details>
 </aside>;
}
