'use client';
import {useI18n} from "./language";

const time=(ms:number)=>`${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;
export default function ClassCornell({value,busy,canPrepare,onPrepare,onReplay,onMaterial,onNote}:{value:any;busy:boolean;canPrepare:boolean;onPrepare:()=>void;onReplay:(ms:number)=>void;onMaterial:(ref:any)=>void;onNote:(id:string)=>void}){
 const {t:ui}=useI18n();
 if(!value)return null;
 const changed=value.transcript_changed||value.changed_sources?.length>0;
 return <section className="beta-class-transcript" aria-label={ui("Cornell class notes")}><h3>{ui("Cornell class notes")}</h3>
 {!value.enabled?<p>{ui("Local Cornell processing is not available yet. Your audio and transcript remain usable.")}</p>:<>
 <p role="status">{value.state==='complete'?ui("Study draft saved in Notebook. Review its explanations against the evidence."):value.state==='failed'?ui("Notes need a retry; accepted sections are kept."):value.state==='cancelled'?ui("Evidence changed; prepare a new draft."):value.paused?ui("Notes are paused outside your selected current courses."):value.state==='leased'?ui("Preparing the next class explanation…"):value.state==='queued'?(value.worker_ready?ui("Waiting for local notes processing. Questions take priority."):ui("Waiting for the local notes worker to return.")):ui("Prepare notes from the saved transcript and actual course passages.")}</p>
 {value.cursor>0&&<p>{value.cursor}{value.units?ui("of")+value.units:''}  {ui("speech units processed. This count does not certify complete class understanding.")}</p>}
 {changed&&<p className="beta-class-warning">{ui("The transcript or cited material changed. Existing notes and your edits are kept; compare their evidence before using them.")}</p>}
 {value.error&&<p role="alert">{value.error}</p>}
 {canPrepare&&(['not_started','failed','cancelled'].includes(value.state)||changed)&&<button disabled={busy||value.paused} onClick={onPrepare}>{value.state==='failed'?ui("Retry Cornell notes"):changed||value.state==='cancelled'?ui("Prepare updated Cornell draft"):ui("Prepare Cornell notes")}</button>}
 </>}
 {value.earlier_notes?.map((n:any,i:number)=><button disabled={busy} key={n.note_id} onClick={()=>onNote(n.note_id)}>{ui("Open earlier Cornell draft")} {i+1}</button>)}
 {value.note_id&&<button disabled={busy} onClick={()=>onNote(value.note_id)}>{ui("Open Cornell draft in Notebook")}</button>}
 {value.chapters?.slice(1).map((chapter:any,i:number)=><button disabled={busy} key={chapter.note_id} onClick={()=>onNote(chapter.note_id)}>{ui("Open Cornell chapter")} {i+2}  {ui("in Notebook")}</button>)}
 {value.sections?.length>0&&<p>{ui("Generated outline · your changes are saved in Notebook.")}</p>}
 {value.sections?.length>0&&<p>{ui("Try answering each cue before opening its explanation. Save your own response or corrections in Notebook.")}</p>}
 {!!value.limitations?.length&&<details><summary>{ui("Coverage and unresolved evidence")}</summary><ul>{value.limitations.map((s:string,i:number)=><li key={i}>{s}</li>)}</ul></details>}
 {value.sections?.map((section:any,index:number)=><div key={index}><h4>{ui("Class section")} {index+1}</h4>{section.summary&&<p>{ui("Section synthesis · AI interpretation:")} {section.summary}</p>}
 {section.topics.map((topic:any,i:number)=><details className="beta-cornell-topic" key={i}><summary>{topic.cue}</summary>
 {topic.teaching_points?.length?<div aria-label={ui("Passage explanations")}><p>{ui("These are AI interpretations of the quoted words. Check uncertain speech and mathematics against the audio and original material.")}</p>{topic.teaching_points.map((point:any,j:number)=><div className="beta-cornell-point" key={j}>
 <h5>{ui("Class passage")} {j+1}  {ui("· unidentified speaker")}</h5><button disabled={busy} onClick={()=>onReplay(point.start_ms)}>{ui("Replay")} {time(point.start_ms)}–{time(point.end_ms)}</button>
 <blockquote>{point.quote}</blockquote>{point.uncertain&&<p className="beta-class-warning">{ui("Uncertain speech. Check the recording before relying on this interpretation.")}</p>}
 <p className="beta-cornell-explanation"><strong>{ui("AI interpretation")}</strong><br/>{point.explanation}</p>
 </div>)}</div>:<p className="beta-cornell-explanation">{topic.explanation}</p>}
 {[['Examples and method','examples'],['Class questions and corrections','questions'],['Conditions and limits','conditions']].map(([label,key])=>topic[key]?.length?<div key={key}><h5>{ui(label)}</h5><ul>{topic[key].map((s:string,j:number)=><li key={j}>{s}</li>)}</ul></div>:null)}
 <h5>{ui("Class evidence · unidentified speaker")}</h5>{topic.evidence.map((ref:any,j:number)=><div key={j}><button onClick={()=>onReplay(ref.start_ms)}>{ui("Replay")} {time(ref.start_ms)}–{time(ref.end_ms)}</button><blockquote>{ref.quote}{ref.uncertain?ui("[uncertain speech]"):''}</blockquote></div>)}
 {!!topic.connections.length&&<h5>{ui("Course connections · proposed comparisons")}</h5>}{topic.connections.map((ref:any,j:number)=><div key={j}>
 {ref.class_evidence&&<><p>{ui("Class wording · unidentified speaker")}</p><button disabled={busy} onClick={()=>onReplay(ref.class_evidence.start_ms)}>{ui("Replay comparison at")} {time(ref.class_evidence.start_ms)}</button><blockquote>{ref.class_evidence.quote}{ref.class_evidence.uncertain?ui("[uncertain speech]"):''}</blockquote></>}
 <button disabled={busy} onClick={()=>onMaterial(ref)}>{ui("Open")} {ref.title}{ref.unit?' · '+ref.unit:''}</button><p>{ref.authority==='student_notes'?ui("Saved student notes"):ui("Saved source passage")}</p><blockquote>{ref.quote}</blockquote><p>{ref.explanation}</p>{ref.relationship==='unresolved'&&<p className="beta-class-warning">{ui("Open the original material to check the missing visual or reference. This comparison does not resolve it.")}</p>}
 {!!ref.limitations?.length&&<details><summary>{ui("Reading limits for this passage")}</summary><ul>{ref.limitations.map((limit:string,k:number)=><li key={k}>{limit}</li>)}</ul></details>}
 </div>)}
 {topic.issues?.map((s:string,j:number)=><p className="beta-class-warning" key={j}>{s}</p>)}
 </details>)}{section.gaps.map((s:string,i:number)=><p className="beta-class-warning" key={i}>{s}</p>)}</div>)}
 </section>;
}
