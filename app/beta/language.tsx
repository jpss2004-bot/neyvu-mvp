'use client';
import {createContext,useContext,useEffect,useState,useCallback,type ReactNode} from 'react';
import {useRouter} from 'next/navigation';
import {Globe2} from 'lucide-react';
import {languageCookie,languageHref,languageTag,supportedLanguage,type Language} from '../../lib/beta/language';
import {translate,type MessageValues} from '../../lib/beta/i18n';

type LanguageState={language:Language;change:(next:Language)=>void;persisted:boolean};
const LanguageContext=createContext<LanguageState>({language:'en',change:()=>{},persisted:true});
export function LanguageProvider({initialLanguage,children}:{initialLanguage:Language;children:ReactNode}){
 const [language,setLanguage]=useState(initialLanguage),[persisted,setPersisted]=useState(true);const router=useRouter();
 useEffect(()=>{setLanguage(initialLanguage);},[initialLanguage]);
 useEffect(()=>{
  document.documentElement.lang=language;
  // An explicit shared URL is also a language choice; carry it through sign-in.
  try{document.cookie=languageCookie+'='+language+'; Path=/; Max-Age=31536000; SameSite=Lax'+(location.protocol==='https:'?'; Secure':'');setPersisted(document.cookie.split(';').some(c=>c.trim()===languageCookie+'='+language));}catch{setPersisted(false);}
 },[language]);
 const change=useCallback((next:Language)=>{
  setLanguage(next);let saved=true;
  try{document.cookie=languageCookie+'='+next+'; Path=/; Max-Age=31536000; SameSite=Lax'+(location.protocol==='https:'?'; Secure':'');saved=document.cookie.split(';').some(c=>c.trim()===languageCookie+'='+next);}catch{saved=false;}
  setPersisted(saved);
  // Re-render server copy/metadata without replacing mounted editors or the URL's
  // chat/course/anchor. The choice is explicit even when cookies are unavailable.
  router.replace(languageHref(location.pathname+location.search+location.hash,next),{scroll:false});
 },[router]);
 useEffect(()=>{const changed=()=>{const selected=supportedLanguage(new URL(location.href).searchParams.get('lang'));if(selected)setLanguage(selected);};window.addEventListener('popstate',changed);return()=>window.removeEventListener('popstate',changed);},[]);
 return <LanguageContext.Provider value={{language,change,persisted}}><div lang={language} style={{display:'contents'}}>{children}</div></LanguageContext.Provider>;
}
export function useI18n(){const state=useContext(LanguageContext);const t=useCallback((message:string,values?:MessageValues)=>translate(state.language,message,values),[state.language]);return {...state,locale:languageTag[state.language],t};}
export function LanguageSelect({compact=false}:{compact?:boolean}){const {language,change,persisted,t}=useI18n();return <label className={'nu-language'+(compact?' nu-language-compact':'')}><Globe2 size={17} aria-hidden="true"/><span className={compact?'beta-sr-only':undefined}>{t('Language')}</span><select aria-label={t('Language')} value={language} onChange={e=>{const next=supportedLanguage(e.target.value);if(next)change(next);}}><option value="en" lang="en">English</option><option value="es" lang="es">Español</option></select>{!persisted&&<small role="status">{t('Language changed for this visit. Your browser could not save the preference.')}</small>}</label>;}
