'use client';
import {useI18n} from "./language";
export type ReadingProgress={reader_ready:boolean;enabled:boolean;total:number;counts:Record<string,number>;blocked_reason:string|null;selection_needed:boolean;excluded_sources:number};
const names:Record<string,string>={not_started:'Awaiting background reading',waiting_text:'Waiting for readable text',limited:'Exceeds the reading limit',queued:'Queued for reading',reading:'Reading now',ready:'Reading drafts ready',partial:'Drafts with gaps or review needs',failed:'Readings needing retry'};
export default function MaterialReading({reading,offline}:{reading?:ReadingProgress;offline:boolean}){
 const {t:ui}=useI18n();
 if(!reading)return null;
 return <details className="beta-reading-progress"><summary>{reading.enabled?ui("Reading your material"):ui("Saved material")} · {reading.total}  {ui("saved sources in scope")}</summary>
  <p>{!reading.enabled?ui("Local reading is disabled. Your saved originals remain usable."):offline||!reading.reader_ready?ui("Background reading is waiting for the local worker. Your originals, notes and questions are saved."):ui("Saved material is read automatically in the background. Chat questions have priority.")}</p>
  {reading.enabled&&reading.selection_needed&&<p>{ui("Confirm your current Moodle courses before background reading.")} <a href="/beta?tab=connection">{ui("Review Moodle connection")}</a></p>}
  {reading.enabled&&reading.blocked_reason&&<p role="status">{ui("Background reading is held because your")} {reading.blocked_reason==='history_limit'?ui("vault history"):ui("reading history")}  {ui("has reached its limit. Existing originals and reading drafts are safe.")}</p>}
  <ul>{Object.entries(names).filter(([key])=>reading.counts[key]>0).map(([key,label])=><li key={key}>{reading.counts[key]} · {!reading.enabled&&['not_started','queued','reading'].includes(key)?ui("Organization unavailable in this release"):ui(label)}</li>)}</ul>
  {!!reading.excluded_sources&&<p>{reading.excluded_sources}  {ui("saved Moodle sources are outside the confirmed current-course scope. Their originals remain in Sources.")}</p>}
  <p>{ui("Open a source to inspect its quotations, gaps and retry options. A ready draft does not verify every requirement, diagram or equation.")}</p>
 </details>;
}
