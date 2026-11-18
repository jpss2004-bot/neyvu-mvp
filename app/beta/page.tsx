import {LanguageSelect} from './language';
import {PublicFooter} from './public-footer';
import {serverI18n} from "../../lib/beta/server-i18n";
import Appearance from './appearance';
import {PRODUCT_NAME,WORDMARK,WORDMARK_LIGHT,SYMBOL,SYMBOL_LIGHT,BRAND_ICONS} from '../../lib/brand';
import type {Metadata} from 'next';
import {pageSession,pageCapabilities} from '../../lib/beta/page-data';
import ServiceUnavailable from './service-unavailable';
import SignInNotice from './signin-notice';
import {guidedSetupTarget,todayCoverageTarget} from '../../lib/beta/desktop';

import BetaWorkspace from './workspace';
import DemoEntry from './demo-entry';
import LocalEntry from './local-entry';
import './beta.css';
import './experience.css';
import './workspace-polish.css';
import './app-shell.css';
import './design-system.css';
import './study-desk.css';
import './quiet-index.css';
import 'katex/dist/katex.min.css';
export const metadata:Metadata={title:PRODUCT_NAME,icons:BRAND_ICONS,description:'Your courses, notes and next steps in one place',manifest:'/beta/manifest.webmanifest',appleWebApp:{capable:true,title:PRODUCT_NAME,statusBarStyle:'default'}};
export const dynamic='force-dynamic';
export default async function BetaPage({searchParams}:{searchParams:Promise<{error?:string;tab?:string;coverage?:string}>}){
 const {t:ui,language}=await serverI18n();
 const params=await searchParams;let session,capabilities;try{[session,capabilities]=await Promise.all([pageSession(),pageCapabilities()]);}catch{return <ServiceUnavailable/>;}
 const actor=session.actor,local=capabilities.localAccountAvailable;
 if(actor)return <BetaWorkspace actor={actor} local={local} captureEnabled={capabilities.captureEnabled}/>;
 if(local)return <LocalEntry/>;
 const ready=capabilities.signInReady,demo=capabilities.demoAvailable;
 const target=params.tab==='setup'?guidedSetupTarget:params.tab==='today'&&params.coverage==='1'?todayCoverageTarget:null;
 const signIn=new URLSearchParams({recovery:'1',...(target?{next:target}:{})});
 return <main className="beta-entry"><div className="beta-entry-tools"><LanguageSelect compact/><Appearance/></div><a className="beta-wordmark" href="/beta/join">{WORDMARK ? <><img className="beta-brand beta-brand-dark" src={WORDMARK} width="158" height="40" alt={PRODUCT_NAME}/><img className="beta-brand beta-brand-light" src={WORDMARK_LIGHT} width="158" height="40" alt={PRODUCT_NAME}/></> : PRODUCT_NAME}<span>{ui("Acadia students")}</span></a><section><img className="beta-symbol beta-brand-dark" src={SYMBOL} width="46" height="46" alt=""/><img className="beta-symbol beta-brand-light" src={SYMBOL_LIGHT} width="46" height="46" alt=""/><h1>{ui("Your courses.")}<br/>{ui("Your study notes.")}</h1><p>{ui("Keep your class notes, course materials and conversations together.")}</p>{params.error?<SignInNotice code={params.error} language={language}/>:null}{ready?<a className="beta-primary beta-google" href={'/beta/auth/start?'+signIn}>{ui("Continue with Google")} <span aria-hidden="true">↗</span></a>:<p className="beta-setup">{ui("The invite-only beta is being prepared. Google sign-in will appear here when it’s ready.")}</p>}<p><a href="/beta/join#request-access">{ui("New here? Request access")}</a></p>{demo&&<DemoEntry open={!ready}/>}<small>{ui("Your Google login identifies your account. It doesn’t connect your email or Moodle.")}</small></section><PublicFooter language={language}/></main>;
}
