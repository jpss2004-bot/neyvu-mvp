import {serverI18n} from "../../../lib/beta/server-i18n";
import {pageSession,pageCapabilities} from '../../../lib/beta/page-data';
import ServiceUnavailable from '../service-unavailable';

import {AdminLogin,AdminRequests} from './admin-ui';
import '../join/join.css';
export const dynamic='force-dynamic';
export default async function AdminPage(){
 const {t:ui}=await serverI18n();let session,capabilities;try{[session,capabilities]=await Promise.all([pageSession(),pageCapabilities()]);}catch{return <ServiceUnavailable/>;}const actor=session.admin;return <main className="sv-admin-page"><div className="sv-admin-shell">{actor?<AdminRequests email={actor.email}/>:<><a className="sv-name" href="/beta/join">{ui("Neyvu")}</a><AdminLogin ready={capabilities.adminReady} recoveryReady={capabilities.accessReady}/></>}</div></main>;}
