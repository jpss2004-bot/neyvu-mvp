'use client';
import {useI18n} from './language';
import {useEffect,useState} from 'react';
import type {LearnerProfile,ProfileFact,ProfileField} from '../../lib/beta/learner-profile';

// D7: the learner's profile in Settings. Hidden unless the server enables it
// (the API answers 404 while SCHOOL_BETA_LEARNER_PROFILE is off).
const accountFields:{field:ProfileField;label:string;options?:string[]}[]=[
 {field:'program',label:'Program'},{field:'year_of_study',label:'Year of study'},
 {field:'answer_length',label:'Answer length',options:['short','standard','detailed']},
 {field:'explanation_style',label:'Explanation style',options:['steps','examples','summary']},
 {field:'accessibility',label:'Accessibility needs'},
];
async function call(query:string,data?:unknown){
 const r=await fetch('/api/beta'+query,{method:data?'POST':'GET',credentials:'same-origin',headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(15000)});
 const body=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(Error(body.error||'Could not save your profile.'),{status:r.status});return body;
}
const authorityLabel=(f:ProfileFact)=>f.authority==='platform_verified'?'Verified by your school platform':f.origin==='group_memory'?'Student-reported (from a course group correction)':'Student-reported';

export default function LearnerProfileSettings(){
 const {t:ui}=useI18n();
 const [profile,setProfile]=useState<LearnerProfile|null>(null),[hidden,setHidden]=useState(false),[status,setStatus]=useState(''),[draft,setDraft]=useState<Record<string,string>>({});
 async function load(){try{const p=await call('?op=learner.profile');setProfile(p);setDraft({});}catch(e:any){if(e.status===404)setHidden(true);else setStatus(e.message);}}
 useEffect(()=>{void load();},[]);
 if(hidden||!profile)return null;
 const own=(field:ProfileField,course:string|null)=>profile.facts.find(f=>f.field===field&&f.course_id===course&&f.origin==='profile'&&f.authority==='student_reported');
 const others=(field:ProfileField,course:string|null)=>profile.facts.filter(f=>f.field===field&&f.course_id===course&&f!==own(field,course));
 async function save(field:ProfileField,course:string|null){
  const key=field+':'+(course||''),value=draft[key];if(value==null)return;const old=own(field,course);
  try{await call('',{op:'learner.profile.save',field,course_id:course,value,...(old?{id:old.id,revision:old.revision}:{})});setStatus('Saved as student-reported.');await load();}catch(e:any){setStatus(e.message);}
 }
 async function forget(f:ProfileFact){try{await call('',{op:'learner.profile.forget',id:f.id,revision:f.revision});setStatus('Removed.');await load();}catch(e:any){setStatus(e.message);}}
 const row=(field:ProfileField,label:string,course:string|null,options?:string[])=>{
  const key=field+':'+(course||''),old=own(field,course),value=draft[key]??old?.value??'';
  return <div className="nu-privacy-row" key={key}>
   <label>{ui(label)}{options
    ?<select value={value} onChange={e=>setDraft({...draft,[key]:e.target.value})}><option value="">{ui('Not set')}</option>{options.map(o=><option key={o} value={o}>{ui(o)}</option>)}</select>
    :<input value={value} maxLength={400} onChange={e=>setDraft({...draft,[key]:e.target.value})}/>}</label>
   {old&&<p>{ui(authorityLabel(old))}</p>}
   {others(field,course).map(f=><p key={f.id}>{f.value} · {ui(authorityLabel(f))}</p>)}
   <div className="nu-settings-actions"><button disabled={!value||value===old?.value} onClick={()=>save(field,course)}>{ui('Save')}</button>{old&&<button onClick={()=>forget(old)}>{ui('Remove')}</button>}</div>
  </div>;
 };
 return <section className="nu-settings-group"><header><h2>{ui('Learner profile')}</h2><p>{ui('What Neyvu knows about you to tailor answers. Anything you enter is labelled student-reported and never treated as verified by your school.')}</p></header>
  <div className="nu-settings-controls">
   {accountFields.map(f=>row(f.field,f.label,null,f.options))}
   {profile.courses.map(c=>row('section',c.code+' section or lab group',c.id))}
   <p className="nu-settings-status" role="status" aria-live="polite">{ui(status)}</p>
  </div></section>;
}
