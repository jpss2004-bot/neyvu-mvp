import {serverI18n} from "../../../lib/beta/server-i18n";
import {PRODUCT_NAME, WORDMARK, WORDMARK_LIGHT} from "../../../lib/brand";
import {pageSession,pageCapabilities} from '../../../lib/beta/page-data';
import ServiceUnavailable from '../service-unavailable';

const demoAccountLabel='Demo reviewer (synthetic data)';
import {desktopTarget} from '../../../lib/beta/desktop';
import ConnectDesktop from './connect';
import '../beta.css';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{port?:string;state?:string}>}){
 const {t:ui}=await serverI18n();
 const p=await searchParams;const valid=desktopTarget(p.port,p.state);let session,capabilities;try{[session,capabilities]=await Promise.all([pageSession(),pageCapabilities()]);}catch{return <ServiceUnavailable/>;}const actor=session.actor;const demo=actor?.demo===true;
 return <main className="beta-entry"><a className="beta-wordmark" href="/beta"><img className="beta-brand-dark" src={WORDMARK} width="138" height="35" alt={PRODUCT_NAME}/><img className="beta-brand-light" src={WORDMARK_LIGHT} width="138" height="35" alt={PRODUCT_NAME}/><span>{ui("Acadia students")}</span></a><section>{valid?<ConnectDesktop port={p.port!} state={p.state!} email={actor?(demo?demoAccountLabel:actor.email):null} demo={demo} demoEntry={!actor&&capabilities.demoAvailable} next={valid}/>:<><h1>{ui("Open the companion first.")}</h1><p>{ui("Choose “Connect Neyvu account” in Neyvu Companion on your computer to start a fresh connection.")}</p><a href="/beta">{ui("Return to Neyvu")}</a></>}</section></main>;
}
