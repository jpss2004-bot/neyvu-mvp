import {betaRoute} from '../../../../lib/beta/api-route';
import {betaActor} from '../../../../lib/beta/auth';
import {betaRequestJson,betaWriteAllowed,betaJson,BetaHttpError} from '../../../../lib/beta/http';
import {uuid} from '../../../../lib/beta/db';
import {requireInstitutions,myOrganizations,orgConsole,inviteMember,revokeInvitation,updateMember,addPublicSource,reviewPublicSource,saveJourney,acceptInvitation} from '../../../../lib/platform/organizations';
export const runtime='nodejs';
async function actor(){requireInstitutions();const a=await betaActor();if(!a)throw new BetaHttpError('Please sign in.',401);return a;}
async function handleGET(request:Request){
 const a=await actor(),org=new URL(request.url).searchParams.get('org');
 if(!org)return betaJson({organizations:await myOrganizations(a.id)});
 if(!uuid(org))throw new BetaHttpError('Organization not found',404);
 return betaJson(await orgConsole(a.id,org));
}
// One POST endpoint keeps the console's write surface small; each action re-checks the
// caller's organization role inside the database transaction.
async function handlePOST(request:Request){
 betaWriteAllowed(request);const a=await actor(),body=await betaRequestJson(request,250000) as any;
 if(body.action==='accept')return betaJson(await acceptInvitation(a.id,a.email,body.token));
 const org=body.org;if(!uuid(org))throw new BetaHttpError('Organization not found',404);
 switch(body.action){
  case 'invite':{const {id,token}=await inviteMember(a.id,org,body);return betaJson({id,link:'/beta/institution?invite='+token});}
  case 'revoke_invitation':return betaJson({ok:await revokeInvitation(a.id,org,body.id)});
  case 'update_member':return betaJson({ok:await updateMember(a.id,org,body.user_id,body)});
  case 'add_source':return betaJson(await addPublicSource(a.id,org,body));
  case 'review_source':return betaJson(await reviewPublicSource(a.id,org,body.id,body.decision,body.note));
  case 'save_journey':return betaJson(await saveJourney(a.id,org,body.journey||{}));
  default:throw new BetaHttpError('Unknown action.');
 }
}
export const GET=betaRoute(handleGET);
export const POST=betaRoute(handlePOST);
