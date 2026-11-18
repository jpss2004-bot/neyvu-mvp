'use client';
import {useCallback,useEffect,useState} from 'react';

type Account={id:string;kind:string;display_name:string;status:string;last_sync_at:string|null;last_error:string|null;site_url:string|null;senders?:{address:string;course_id:string}[]};
type Data={courses:{id:string;code:string;title:string}[];accounts:Account[];session_bridge:{status:string;checked_at:string|null;revoked_at:string|null}|null;available:{kind:string;institutions?:{id:string;name:string}[]}[]};

const labels:Record<string,{name:string;about:string}>={
 moodle_token:{name:'Moodle (direct)',about:'Reads your courses, files, assignments, calendar and groups through Moodle’s mobile service. Neyvu keeps a revocable token, never your password.'},
 canvas:{name:'Canvas',about:'Reads courses, pages, assignments and file listings with your permission. Read-only.'},
 brightspace:{name:'Brightspace',about:'Reads enrollments, content and assignment folders with your permission. Read-only.'},
 outlook:{name:'Outlook',about:'Reads only mail from course senders you confirm. Everything else is discarded and never saved.'},
 gmail:{name:'Gmail',about:'Reads only mail from course senders you confirm. Everything else is discarded and never saved.'},
};
const statusText:Record<string,string>={connected:'Connected',needs_reauth:'Sign in again',error:'Needs attention'};

async function post(url:string,body:object){
 const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Something went wrong.');return d;
}

export default function Connections(){
 const [data,setData]=useState<Data|null>(null),[notice,setNotice]=useState(''),[busy,setBusy]=useState('');
 const [moodle,setMoodle]=useState<{site:string;step:'site'|'password'|'sso';state?:string;launch?:string;username:string;password:string;callback:string}>({site:'',step:'site',username:'',password:'',callback:''});
 const [sender,setSender]=useState<Record<string,{address:string;course:string}>>({});
 const load=useCallback(async()=>{const r=await fetch('/api/beta/connections',{cache:'no-store'});const d=await r.json();if(r.ok)setData(d);else setNotice(d.error||'Connections could not be loaded.');},[]);
 useEffect(()=>{load();const q=new URLSearchParams(location.search);if(q.get('connected'))setNotice(`${labels[q.get('connected')!]?.name||'Account'} connected. Run a sync to bring its material in.`);if(q.get('error'))setNotice(q.get('error')!);},[load]);
 const run=async(key:string,fn:()=>Promise<void>)=>{setBusy(key);setNotice('');try{await fn();}catch(e){setNotice((e as Error).message);}finally{setBusy('');}};
 const start=(kind:string,institution_id?:string)=>run('start-'+kind,async()=>{const d=await post('/api/beta/connections',{action:'start',kind,institution_id});if(d.authorize_url)location.href=d.authorize_url;});
 const moodleStart=()=>run('moodle',async()=>{const d=await post('/api/beta/connections',{action:'start',kind:'moodle_token',site_url:moodle.site});setMoodle(m=>({...m,site:d.site_url,step:d.method,state:d.state,launch:d.launch_url}));});
 const moodlePassword=()=>run('moodle',async()=>{await post('/api/beta/connections',{action:'moodle_password',site_url:moodle.site,username:moodle.username,password:moodle.password});setMoodle({site:'',step:'site',username:'',password:'',callback:''});setNotice('Moodle connected. Your password was used once and not saved.');await load();});
 const moodleSso=()=>run('moodle',async()=>{await post('/api/beta/connections',{action:'moodle_sso',state:moodle.state,callback:moodle.callback});setMoodle({site:'',step:'site',username:'',password:'',callback:''});setNotice('Moodle connected.');await load();});
 const act=(account:Account,action:string,extra:object={})=>run(action+account.id,async()=>{
  if(action==='disconnect'&&!confirm(`Disconnect ${account.display_name}? Neyvu deletes its access token. Material already saved stays until you remove it.`))return;
  const d=await post('/api/beta/connections/account',{account_id:account.id,action,...extra});
  if(action==='sync')setNotice(`Sync ${d.status}: ${d.counts.sources_new} new, ${d.counts.sources_updated} updated, ${d.counts.files_saved} files${d.counts.mail_kept?`, ${d.counts.mail_kept} course emails kept, ${d.counts.mail_discarded} discarded`:''}.${d.issues?.length?' '+d.issues.slice(0,2).join(' '):''}`);
  await load();
 });
 if(!data)return <section className="nu-connections"><h1>Connections</h1><p>{notice||'Loading…'}</p></section>;
 const connected=new Set(data.accounts.map(a=>a.kind));
 return <section className="nu-connections">
  <h1>Connections</h1>
  <p>Bring your course platforms and course mail into Neyvu. Every connection is read-only: Neyvu never posts, submits or sends anything.</p>
  {notice&&<p className="nu-conn-notice" role="status">{notice}</p>}
  <article className="nu-conn-card"><header><h2>Desktop Companion (Moodle session bridge)</h2><span className="nu-conn-status" data-state={data.session_bridge&&!data.session_bridge.revoked_at?'connected':'none'}>{data.session_bridge&&!data.session_bridge.revoked_at?'Connected':'Not connected'}</span></header>
   <p>For Moodle sites without mobile access, the Companion reads pages with your own browser session on your laptop.{data.session_bridge?.checked_at?` Last check ${new Date(data.session_bridge.checked_at).toLocaleString()}.`:''}</p>
   <div className="nu-conn-actions"><a href="/beta/desktop-connect">Manage the Companion</a></div></article>
  {data.accounts.map(a=><article className="nu-conn-card" key={a.id}>
   <header><h2>{labels[a.kind]?.name||a.kind} · {a.display_name}</h2><span className="nu-conn-status" data-state={a.status}>{statusText[a.status]||a.status}</span></header>
   <p>{a.last_sync_at?`Last synced ${new Date(a.last_sync_at).toLocaleString()}.`:'Not synced yet.'}{a.last_error?` Last problem: ${a.last_error}.`:''}</p>
   {a.senders&&<><p>Confirmed course senders (only their mail is kept):</p>
    <ul className="nu-conn-senders">{a.senders.map(s=><li key={s.address}>{s.address} → {data.courses.find(c=>c.id===s.course_id)?.code||'course'} <button type="button" onClick={()=>act(a,'remove_sender',{address:s.address})}>Remove</button></li>)}{!a.senders.length&&<li>None yet. Add your instructors’ addresses below.</li>}</ul>
    <div className="nu-conn-form"><input type="email" placeholder="instructor@school.edu" aria-label="Course sender email" value={sender[a.id]?.address||''} onChange={e=>setSender(s=>({...s,[a.id]:{course:s[a.id]?.course||'',address:e.target.value}}))}/>
     <select aria-label="Course" value={sender[a.id]?.course||''} onChange={e=>setSender(s=>({...s,[a.id]:{address:s[a.id]?.address||'',course:e.target.value}}))}><option value="">Choose a course</option>{data.courses.map(c=><option key={c.id} value={c.id}>{c.code} · {c.title}</option>)}</select>
     <button type="button" disabled={!!busy} onClick={()=>act(a,'add_sender',{address:sender[a.id]?.address,course_id:sender[a.id]?.course})}>Confirm sender</button></div></>}
   <div className="nu-conn-actions">
    {a.status==='needs_reauth'?<button type="button" className="primary" onClick={()=>a.kind==='moodle_token'?setMoodle(m=>({...m,site:a.site_url||''})):start(a.kind)}>Sign in again</button>:<button type="button" className="primary" disabled={!!busy} onClick={()=>act(a,'sync')}>{busy==='sync'+a.id?'Syncing…':'Sync now'}</button>}
    <button type="button" disabled={!!busy} onClick={()=>act(a,'disconnect')}>Disconnect</button>
   </div>
  </article>)}
  {data.available.filter(x=>x.kind!=='moodle_token'&&!(connected.has(x.kind)&&(x.kind==='outlook'||x.kind==='gmail'))).map(x=><article className="nu-conn-card" key={x.kind}>
   <header><h2>{labels[x.kind].name}</h2><span className="nu-conn-status">Not connected</span></header><p>{labels[x.kind].about}</p>
   <div className="nu-conn-actions">{x.institutions?x.institutions.map(i=><button key={i.id} type="button" disabled={!!busy} onClick={()=>start(x.kind,i.id)}>Connect {i.name}</button>):<button type="button" className="primary" disabled={!!busy} onClick={()=>start(x.kind)}>Connect {labels[x.kind].name}</button>}</div>
  </article>)}
  {data.available.some(x=>x.kind==='moodle_token')&&<article className="nu-conn-card"><header><h2>{labels.moodle_token.name}</h2><span className="nu-conn-status">Add a site</span></header><p>{labels.moodle_token.about}</p>
   {moodle.step==='site'&&<div className="nu-conn-form"><input placeholder="moodle.yourschool.edu" aria-label="Moodle site address" value={moodle.site} onChange={e=>setMoodle(m=>({...m,site:e.target.value}))}/><button type="button" className="primary" disabled={!moodle.site||!!busy} onClick={moodleStart}>Continue</button></div>}
   {moodle.step==='password'&&<div className="nu-conn-form"><p>{moodle.site} uses its own sign-in. Your password is sent once to Moodle to get a token and is not saved.</p><input autoComplete="username" placeholder="Moodle username" aria-label="Moodle username" value={moodle.username} onChange={e=>setMoodle(m=>({...m,username:e.target.value}))}/><input type="password" autoComplete="current-password" placeholder="Moodle password" aria-label="Moodle password" value={moodle.password} onChange={e=>setMoodle(m=>({...m,password:e.target.value}))}/><button type="button" className="primary" disabled={!!busy} onClick={moodlePassword}>Connect</button></div>}
   {moodle.step==='sso'&&<div className="nu-conn-form"><p>{moodle.site} uses your school’s single sign-on. Open the sign-in, finish it, then paste the link that starts with <code>neyvu://token=</code> (the desktop Companion can do this for you).</p><a href={moodle.launch} target="_blank" rel="noreferrer">Open Moodle sign-in</a><input placeholder="neyvu://token=…" aria-label="Moodle sign-in link" value={moodle.callback} onChange={e=>setMoodle(m=>({...m,callback:e.target.value}))}/><button type="button" className="primary" disabled={!moodle.callback||!!busy} onClick={moodleSso}>Finish</button></div>}
  </article>}
 </section>;
}
