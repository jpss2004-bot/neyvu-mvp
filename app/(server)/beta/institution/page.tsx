import {betaActor} from '../../../../lib/beta/auth';
import {institutionsEnabled,myOrganizations} from '../../../../lib/platform/organizations';
import InstitutionConsole from './console';
import './console.css';
export const dynamic='force-dynamic';
export const metadata={title:'Institution console · Neyvu',robots:{index:false}};
// Admin area for an organization's staff and admins. Learner content is never shown here:
// members, institution-public sources, onboarding journeys and aggregate usage only.
export default async function InstitutionPage({searchParams}:{searchParams:Promise<{invite?:string;org?:string}>}){
 const params=await searchParams;
 if(!institutionsEnabled())return <main className="nv-inst"><h1>Institution console</h1><p>Institution features are not available yet.</p></main>;
 let actor;try{actor=await betaActor();}catch{actor=null;}
 if(!actor)return <main className="nv-inst"><h1>Institution console</h1><p><a href="/beta">Sign in</a> to continue.</p></main>;
 const orgs=(await myOrganizations(actor.id)).filter(o=>o.role!=='learner');
 return <main className="nv-inst"><InstitutionConsole orgs={orgs} invite={typeof params.invite==='string'?params.invite:null} initialOrg={params.org??orgs[0]?.org_id??null}/></main>;
}
