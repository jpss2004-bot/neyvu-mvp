'use client';
import {useEffect,useRef,useState} from 'react';
import type {SourceLibraryPage} from '../../lib/beta/source-library-types';

type Read=(query:string,data?:unknown,signal?:AbortSignal)=>Promise<unknown>;
export function useSourceLibrary(visible:boolean,course:string,kind:string,query:string,read:Read){
 const scope=JSON.stringify([course,kind,query]);
 const [navigation,setNavigation]=useState({scope,index:0,cursors:[null] as (string|null)[]});
 const nav=navigation.scope===scope?navigation:{scope,index:0,cursors:[null]};
 const cursor=nav.cursors[nav.index],key=JSON.stringify([scope,cursor]);
 const [revision,setRevision]=useState(0),[state,setState]=useState<{key:string;data:SourceLibraryPage|null;loading:boolean;error:string}>({key:'',data:null,loading:false,error:''});
 const reader=useRef(read);reader.current=read;
 // Commit a scope reset even if this filter is only visited briefly. Returning
 // to an earlier filter must not resurrect its old cursor history.
 useEffect(()=>{setNavigation(current=>current.scope===scope?current:{scope,index:0,cursors:[null]});},[scope]);
 useEffect(()=>{
  if(!visible)return;let current=true;const controller=new AbortController();
  setState(old=>({key,data:old.key===key?old.data:null,loading:true,error:''}));
  const params=new URLSearchParams({op:'sources.library',q:query,limit:'20'});if(course)params.set('course',course);if(kind)params.set('kind',kind);if(cursor)params.set('cursor',cursor);
  reader.current(params.toString(),undefined,controller.signal).then((value:SourceLibraryPage)=>{
   if(!value||!Array.isArray(value.sources)||!Number.isSafeInteger(value.total)||value.total<0||value.limit!==20||value.next_cursor!==null&&typeof value.next_cursor!=='string')throw Error('The material list was incomplete. Try again.');
   if(current)setState({key,data:value,loading:false,error:''});
  }).catch(error=>{if(current)setState(old=>({key,data:old.key===key?old.data:null,loading:false,error:error instanceof Error?error.message:'Saved material could not load. Try again.'}));});
  return()=>{current=false;controller.abort();};
 },[visible,key,revision]);
 const matching=state.key===key,data=matching?state.data:null;
 return {data,page:nav.index,loading:visible&&(!matching||state.loading),error:matching?state.error:'',
  retry:()=>setRevision(n=>n+1),
  reload:()=>{setNavigation({scope,index:0,cursors:[null]});setRevision(n=>n+1);},
  next:()=>{if(data?.next_cursor&&!state.loading)setNavigation({scope,index:nav.index+1,cursors:[...nav.cursors.slice(0,nav.index+1),data.next_cursor]});},
  previous:()=>{if(nav.index>0&&!state.loading)setNavigation({...nav,index:nav.index-1});},
 };
}
