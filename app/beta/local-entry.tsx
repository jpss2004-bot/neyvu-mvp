'use client';
import {useI18n,LanguageSelect} from "./language";

import {PRODUCT_NAME,WORDMARK,WORDMARK_LIGHT,SYMBOL,SYMBOL_LIGHT} from '../../lib/brand';
import Appearance from './appearance';

import {useEffect,useRef,useState} from 'react';

export default function LocalEntry(){
 const {t:ui}=useI18n();
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const request=useRef<AbortController|null>(null),generation=useRef(0);
 useEffect(()=>{generation.current++;return()=>{generation.current++;request.current?.abort();};},[]);

 async function openVault(){
  if(request.current)return;
  const current=generation.current,controller=new AbortController();
  request.current=controller;setBusy(true);setError('');
  const timeout=setTimeout(()=>controller.abort(),30000);
  try{
   const response=await fetch('/api/beta/local',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'start'}),signal:controller.signal});
   if(!response.ok)throw Error('Local vault unavailable');
   if(generation.current===current)window.location.assign('/beta');
  }catch{
   if(generation.current===current){setError('Your local vault could not open. Try again.');setBusy(false);}
  }finally{
   clearTimeout(timeout);
   if(request.current===controller)request.current=null;
  }
 }

 return <main className="beta-entry"><div className="beta-entry-tools"><LanguageSelect compact/><Appearance/></div><a className="beta-wordmark" href="/beta"><img className="beta-brand-dark" src={WORDMARK} width="150" height="38" alt={PRODUCT_NAME}/><img className="beta-brand-light" src={WORDMARK_LIGHT} width="150" height="38" alt={PRODUCT_NAME}/><span>{ui("Local vault")}</span></a><section><span className="beta-symbol" aria-hidden="true"><img className="beta-brand-dark" src={SYMBOL} width="46" height="46" alt=""/><img className="beta-brand-light" src={SYMBOL_LIGHT} width="46" height="46" alt=""/></span><h1>{ui("Your school vault,")}<br/>{ui("on this computer.")}</h1><p>{ui("Bring your courses, files and notes together in Neyvu.")}</p>{error&&<p className="beta-alert" role="alert">{ui(error)}</p>}<button type="button" className="beta-primary beta-google" disabled={busy} onClick={openVault}>{busy?ui("Opening your local vault…"):ui("Open your local vault")}</button><small>{ui("This local account needs no Google or Notion sign-in. It uses a private copy of your saved personal vault. Original files and connected accounts are preserved.")}</small></section><footer>{ui("Neyvu · Local test")}</footer></main>;
}
