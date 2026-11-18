'use client';
import {useEffect,useState} from 'react';
import type {Assessment} from '../../lib/beta/assessments-format';
import type {InstructorAsk} from '../../lib/beta/instructor-asks';
export type AssessmentRead={data:{assessments:Assessment[];asks:InstructorAsk[]}|null;loading:boolean;error:string;retry:()=>void};
export function useAssessments(visible:boolean,refreshKey:unknown):AssessmentRead{
 const [data,setData]=useState<AssessmentRead['data']>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{if(!visible)return;let active=true;const controller=new AbortController();setLoading(true);setError('');setData(null);const timeout=setTimeout(()=>controller.abort(),15000);
 fetch('/api/beta?op=understanding',{credentials:'same-origin',signal:controller.signal}).then(async r=>{const body=await r.json();if(!r.ok)throw Error(body.error||'Could not read saved dates.');if(!Array.isArray(body.assessments)||!Array.isArray(body.asks))throw Error('Saved assessment data was incomplete. Try loading it again.');if(active)setData(body);}).catch(e=>{if(active)setError(e.name==='AbortError'?'Saved assessment dates could not be loaded. Try again.':e.message||'Could not read saved dates.');}).finally(()=>{if(active)setLoading(false);});
 return()=>{active=false;clearTimeout(timeout);controller.abort();};},[visible,refreshKey,revision]);return {data,loading,error,retry:()=>setRevision(n=>n+1)};
}
