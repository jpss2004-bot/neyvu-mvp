import {addActiveLabs,requestAssignmentCheck,assignmentCheckStatus,claimAssignmentCheck,finishAssignmentCheck} from '../../../../lib/beta/connector-recovery';
import {importCourseMembership} from '../../../../lib/beta/course-membership';
import {createHash} from 'node:crypto';
import {deviceContentAction} from '../../../../lib/beta/device-content-store';
import {devicePdfFormat} from '../../../../lib/beta/device-content';
import {withUpload} from '../../../../lib/beta/uploads';
import {betaRoute} from '../../../../lib/beta/api-route';
import {betaActor} from '../../../../lib/beta/auth';
import {betaEnabled} from '../../../../lib/beta/config';
import {betaJson,betaError,betaWriteAllowed,betaRequestJson,BetaHttpError,limitedBody} from '../../../../lib/beta/http';
import {createCompanionPairing,redeemCompanionPairing,companionActor,companionDevices,revokeCompanion,importMoodleCapture,confirmCompanionCourses} from '../../../../lib/beta/companion';
import {simulateDemoCollection} from '../../../../lib/beta/demo';
import {importMoodleFile} from '../../../../lib/beta/moodle-files';
import {originalMimes} from '../../../../lib/beta/file-types';
import {companionStatus} from '../../../../lib/beta/companion';
import {optionalClientBucket,rateLimit} from '../../../../lib/beta/admissions';
export const runtime='nodejs';
async function handleGET(){try{if(!betaEnabled())throw new BetaHttpError('Beta unavailable.',503);const actor=await betaActor();if(!actor)throw new BetaHttpError('Please sign in.',401);return betaJson({devices:await companionDevices(actor.id)});}catch(e){return betaError(e);}}
async function handlePOST(request:Request){
 try{
  if(!betaEnabled())throw new BetaHttpError('Beta unavailable.',503);
  const authorization=request.headers.get('authorization');
  if(authorization){
   if(request.headers.has('origin'))throw new BetaHttpError('Use the Windows companion for this action.',403);
   const actor=await companionActor(authorization.startsWith('Bearer ')?authorization.slice(7):'');
   const operation=new URL(request.url).searchParams.get('op');
   if(operation?.startsWith('content.')){
    if(process.env.SCHOOL_BETA_DEVICE_CONTENT!=='1'&&!['content.inspect','content.cancel'].includes(operation))return betaJson({enabled:false,format:devicePdfFormat,legacy_binary_path:'unchanged'});
    const op=operation.slice(8);if(!['negotiate','begin','batch','inspect','commit','cancel'].includes(op))throw new BetaHttpError('Unknown device content operation.');
    const body=await betaRequestJson(request,op==='begin'?600000:op==='batch'?256000:1000);
    return betaJson(await deviceContentAction({...actor,grantHash:createHash('sha256').update(authorization.slice(7)).digest('hex')},op,body));
   }
   if(operation==='labs')return betaJson(await addActiveLabs(actor,await betaRequestJson(request,12000)));
   if(operation==='check.claim'){await limitedBody(request,1000);return betaJson(await claimAssignmentCheck(actor));}
   if(operation==='check.finish')return betaJson(await finishAssignmentCheck(actor,await betaRequestJson(request,1000)));
   if(operation==='membership')return betaJson(await importCourseMembership(actor,await betaRequestJson(request,16000)));
   if(operation==='status'||operation==='disconnect'){await limitedBody(request,1000);return betaJson(operation==='status'?await companionStatus(actor):await revokeCompanion(actor.user,actor.device));}
   if(operation==='file'){
    const encoded=request.headers.get('x-schoolvault-capture')||'';
    if(!/^[A-Za-z0-9_-]+$/.test(encoded)||encoded.length>10668)throw new BetaHttpError('Invalid Moodle file metadata');
    const decoded=Buffer.from(encoded,'base64url');if(decoded.length>8000||decoded.toString('base64url')!==encoded)throw new BetaHttpError('Invalid Moodle file metadata');
    let metadata;try{metadata=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decoded));}catch{throw new BetaHttpError('Invalid Moodle file metadata');}
    const mime=(request.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
    if(!originalMimes.includes(mime))throw new BetaHttpError('Use a PDF, Word document, PowerPoint slides or text original.',415);
    return await withUpload(request,actor.user,10*1024*1024,async bytes=>betaJson(await importMoodleFile(actor,metadata,mime,bytes)));
   }
   // A laptop paired with the demo account can replay the synthetic collection; real vaults refuse.
   if(new URL(request.url).searchParams.get('op')==='demo-collect')return betaJson(await simulateDemoCollection(actor));
   if(!request.headers.get('content-type')?.startsWith('application/json'))throw new BetaHttpError('Use JSON',415);
   let data;try{data=JSON.parse((await limitedBody(request,operation==='courses'?8000:400000)).toString('utf8'));}catch(e){if(e instanceof BetaHttpError)throw e;throw new BetaHttpError('Invalid capture');}
   if(operation==='courses')return betaJson({saved:true,current_courses:await confirmCompanionCourses(actor,data)});
   return betaJson(await importMoodleCapture(actor,data));
  }
  // Redeeming a random 256-bit, single-use code does not authenticate a browser session.
  if(new URL(request.url).searchParams.get('op')==='redeem'){
   // Pairing steps are logged without account details so a stuck connection shows which step failed.
   try{
    if(request.headers.has('origin'))throw new BetaHttpError('Use the Windows companion for this action.',403);
    await rateLimit('companion-redeem',optionalClientBucket(request),10);
    const body=await betaRequestJson(request);const result=await redeemCompanionPairing(body.code,body.replace_device_id);
    console.log(JSON.stringify({event:'companion-redeem',ok:true}));return betaJson(result);
   }catch(e){console.log(JSON.stringify({event:'companion-redeem',ok:false,status:e instanceof BetaHttpError?e.status:500}));throw e;}
  }
  betaWriteAllowed(request);const actor=await betaActor();if(!actor)throw new BetaHttpError('Please sign in.',401);
  const body=await betaRequestJson(request);
  if(body.op==='check.request')return betaJson(await requestAssignmentCheck(actor.id,body.source_id));
  if(body.op==='check.status')return betaJson(await assignmentCheckStatus(actor.id,body.source_id));
  if(body.op==='pair'){const result=await createCompanionPairing(actor.id);console.log(JSON.stringify({event:'companion-pair',ok:true}));return betaJson(result,201);}
  if(body.op==='revoke')return betaJson(await revokeCompanion(actor.id,body.device_id));
  throw new BetaHttpError('Unknown connection action');
 }catch(e){return betaError(e);}
}

export const GET=betaRoute(handleGET);
export const POST=betaRoute(handlePOST);
