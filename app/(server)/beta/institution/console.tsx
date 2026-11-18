'use client';
import {useCallback,useEffect,useState,type FormEvent} from 'react';

type Org={org_id:string;slug:string;name:string;role:string};
type Data={organization:{id:string;name:string;kind:string;data_region:string};role:string;
 members:{user_id:string;name:string;email:string;role:string;status:string;joined_at:string}[];
 invitations:{id:string;role:string;expires_at:string;accepted_at:string|null;revoked_at:string|null}[];
 sources:{id:string;title:string;url:string;kind:string;review_status:string;review_note:string;observed_at:string;chars:number}[];
 journeys:{id:string;slug:string;title:string;summary:string;clarify:string[];official_source_id:string|null;route:{label?:string;office?:string;url?:string;contact?:string};status:string}[];
 usage:{window_days:number;metrics:{metric:string;total:string;days:number}[];peak_daily_learners:string}|null};

async function call(body:object){
 const r=await fetch('/api/beta/institution',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'Something went wrong.');return j;
}
const form=(e:FormEvent<HTMLFormElement>)=>Object.fromEntries(new FormData(e.currentTarget)) as Record<string,string>;
const metricLabel:Record<string,string>={active_learners:'Learner-days active',questions:'Questions asked',sources_added:'Sources added',journeys_opened:'Journeys opened',assistant_calls:'Assistant (MCP) reads'};

export default function InstitutionConsole({orgs,invite,initialOrg}:{orgs:Org[];invite:string|null;initialOrg:string|null}){
 const [org,setOrg]=useState(initialOrg);const [data,setData]=useState<Data|null>(null);const [status,setStatus]=useState('');
 const load=useCallback(async()=>{if(!org)return;const r=await fetch('/api/beta/institution?org='+org);const j=await r.json();if(r.ok)setData(j);else setStatus(j.error||'Could not load.');},[org]);
 useEffect(()=>{load();},[load]);
 async function act(body:object,done='Saved.'){setStatus('Working…');try{const r=await call({org,...body});setStatus(r.link?`Invitation link (shown once): ${location.origin}${r.link}`:done);await load();}catch(e:any){setStatus(e.message);}}
 if(invite)return <section><h1>Join an organization</h1><p>Accept this invitation with the account you are signed in with. Your organization will see that you are a member and aggregate usage counts, never your notes, sources or conversations.</p>
  <button onClick={async()=>{try{await call({action:'accept',token:invite});setStatus('You joined. You can close this page.');}catch(e:any){setStatus(e.message);}}}>Accept invitation</button><p className="nv-status" role="status">{status}</p></section>;
 if(!orgs.length)return <section><h1>Institution console</h1><p>You are not a staff member or admin of any organization.</p></section>;
 const admin=data?.role==='admin';
 return <section>
  <header><h1>{data?.organization.name??'Institution console'}</h1>
   <p className="nv-note">Signed in as {data?.role}. Data region: {data?.organization.data_region}. This console never shows learner notes, sources or conversations.</p>
   {orgs.length>1&&<select aria-label="Organization" value={org??''} onChange={e=>setOrg(e.target.value)}>{orgs.map(o=><option key={o.org_id} value={o.org_id}>{o.name}</option>)}</select>}
  </header>
  <p className="nv-status" role="status" aria-live="polite">{status}</p>

  <h2>Members and invitations</h2>
  {admin&&<form onSubmit={e=>{e.preventDefault();const f=form(e);act({action:'invite',email:f.email,role:f.role});e.currentTarget.reset();}}>
   <input name="email" type="email" required placeholder="name@school.ca" aria-label="Email to invite"/>
   <select name="role" aria-label="Role" defaultValue="learner"><option value="learner">Learner</option><option value="staff">Staff</option><option value="admin">Admin</option></select>
   <button>Create invitation</button></form>}
  <table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th>{admin&&<th>Change</th>}</tr></thead><tbody>
   {data?.members.map(m=><tr key={m.user_id}><td>{m.name||'—'}</td><td>{m.email}</td><td>{m.role}</td><td>{m.status}</td>
    {admin&&<td><select aria-label={`Role for ${m.email}`} value={m.role} onChange={e=>act({action:'update_member',user_id:m.user_id,role:e.target.value})}><option>learner</option><option>staff</option><option>admin</option></select>{' '}
     <button type="button" onClick={()=>act({action:'update_member',user_id:m.user_id,status:m.status==='active'?'suspended':'active'})}>{m.status==='active'?'Suspend':'Restore'}</button></td>}</tr>)}
  </tbody></table>
  {admin&&!!data?.invitations.length&&<table><caption className="nv-note">Invitations</caption><thead><tr><th>Role</th><th>Expires</th><th>State</th><th/></tr></thead><tbody>
   {data.invitations.map(i=><tr key={i.id}><td>{i.role}</td><td>{new Date(i.expires_at).toLocaleDateString()}</td><td>{i.accepted_at?'accepted':i.revoked_at?'revoked':'open'}</td>
    <td>{!i.accepted_at&&!i.revoked_at&&<button type="button" onClick={()=>act({action:'revoke_invitation',id:i.id})}>Revoke</button>}</td></tr>)}</tbody></table>}

  <h2>Institution knowledge sources</h2>
  <p className="nv-note">Public, official pages only (policies, calendars, service pages). Learners see a source after an admin approves it. Editing a source sends it back to review.</p>
  <form onSubmit={e=>{e.preventDefault();const f=form(e);act({action:'add_source',...f});e.currentTarget.reset();}}>
   <input name="title" required placeholder="Title" aria-label="Source title"/><input name="url" type="url" required placeholder="https://…" aria-label="Official link"/>
   <select name="kind" aria-label="Kind" defaultValue="page">{['policy','calendar','service','faq','page','other'].map(k=><option key={k}>{k}</option>)}</select>
   <textarea name="body" placeholder="Official text (paste the relevant section)" aria-label="Official text"/><button>Add for review</button></form>
  <table><thead><tr><th>Source</th><th>Kind</th><th>Review</th><th>Action</th></tr></thead><tbody>
   {data?.sources.map(s=><tr key={s.id}><td><a href={s.url} rel="noreferrer" target="_blank">{s.title}</a><div className="nv-note">{s.chars} chars · seen {new Date(s.observed_at).toLocaleDateString()}{s.review_note?' · '+s.review_note:''}</div></td><td>{s.kind}</td>
    <td><span className="nv-pill" data-s={s.review_status}>{s.review_status}</span></td>
    <td>{admin&&s.review_status!=='approved'&&<button type="button" onClick={()=>act({action:'review_source',id:s.id,decision:'approved'})}>Approve</button>}{' '}
     {s.review_status!=='flagged'&&<button type="button" onClick={()=>{const note=prompt('Why flag this source?')||'';act({action:'review_source',id:s.id,decision:'flagged',note});}}>Flag</button>}</td></tr>)}
  </tbody></table>

  <h2>Onboarding journeys</h2>
  <p className="nv-note">Each journey is clarify → official source → route. It can be published only with an approved source.</p>
  <JourneyForm sources={data?.sources.filter(s=>s.review_status==='approved')??[]} onSave={j=>act({action:'save_journey',journey:j})}/>
  <table><thead><tr><th>Journey</th><th>Clarify</th><th>Route</th><th>Status</th></tr></thead><tbody>
   {data?.journeys.map(j=><tr key={j.id}><td>{j.title}<div className="nv-note">{j.summary}</div></td><td><ol>{j.clarify.map((q,i)=><li key={i}>{q}</li>)}</ol></td>
    <td>{j.route.label}{j.route.office?` · ${j.route.office}`:''}</td><td><span className="nv-pill" data-s={j.status}>{j.status}</span></td></tr>)}
  </tbody></table>

  {admin&&data?.usage&&<><h2>Usage (last {data.usage.window_days} days, aggregate)</h2>
   <p className="nv-note">Counts only. Values under 5 show as “&lt;5” so no learner can be singled out.</p>
   <div className="nv-tiles"><div className="nv-tile"><b>{data.usage.peak_daily_learners}</b>Peak learners in a day</div>
    {data.usage.metrics.map(m=><div className="nv-tile" key={m.metric}><b>{m.total}</b>{metricLabel[m.metric]??m.metric}</div>)}</div></>}
 </section>;
}

const presets=[
 {slug:'missed-test',title:'I missed a test',clarify:['Which course and which assessment?','Was it a midterm, quiz or final exam?','Do you have documentation (medical, compassionate)?'],route:{label:'Contact your instructor within the policy window',office:'Registrar'}},
 {slug:'room-booking',title:'Book a study room',clarify:['Which campus building?','How many people and for how long?'],route:{label:'Book through the library',office:'Library'}},
 {slug:'platform-access',title:'I cannot access the learning platform',clarify:['Which platform (Moodle, email, Wi-Fi)?','What error do you see?'],route:{label:'Open an IT service desk ticket',office:'IT services'}},
];
function JourneyForm({sources,onSave}:{sources:{id:string;title:string}[];onSave:(j:object)=>void}){
 const [preset,setPreset]=useState(0);const p=presets[preset];
 return <form key={preset} onSubmit={e=>{e.preventDefault();const f=form(e);onSave({slug:f.slug,title:f.title,summary:f.summary,clarify:f.clarify.split('\n').map(s=>s.trim()).filter(Boolean),official_source_id:f.source||null,route:{label:f.route_label,office:f.route_office,url:f.route_url||undefined},status:f.status});}}>
  <select aria-label="Start from a template" value={preset} onChange={e=>setPreset(Number(e.target.value))}>{presets.map((x,i)=><option key={x.slug} value={i}>{x.title}</option>)}</select>
  <input name="slug" defaultValue={p.slug} aria-label="Short name" required/><input name="title" defaultValue={p.title} aria-label="Journey title" required/>
  <input name="summary" placeholder="One-line summary" aria-label="Summary"/>
  <textarea name="clarify" defaultValue={p.clarify.join('\n')} aria-label="Clarifying questions, one per line"/>
  <select name="source" aria-label="Official source" defaultValue=""><option value="">Official source…</option>{sources.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select>
  <input name="route_label" defaultValue={p.route.label} aria-label="Route" required/><input name="route_office" defaultValue={p.route.office} aria-label="Office"/><input name="route_url" type="url" placeholder="https://… (route link)" aria-label="Route link"/>
  <select name="status" aria-label="Status" defaultValue="draft"><option value="draft">Draft</option><option value="published">Published</option></select>
  <button>Save journey</button></form>;
}
