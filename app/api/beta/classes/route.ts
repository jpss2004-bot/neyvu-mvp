import {betaRoute} from '../../../../lib/beta/api-route';
import {betaActor} from '../../../../lib/beta/auth';
import {betaJson,betaError,betaWriteAllowed,betaRequestJson,BetaHttpError} from '../../../../lib/beta/http';
import {createClassSession,classRecording,listClassRecordings,sealClassRecording,correctClassTranscript,classCaptureEnabled,classAccountMatches} from '../../../../lib/beta/class-recordings';
import {transcriptionEnabled,queueClassTranscription} from '../../../../lib/beta/class-transcription';
import {queueClassCornell,classCornellView} from '../../../../lib/beta/class-cornell';
import {prepareClassActions,classActionsEnabled} from '../../../../lib/beta/class-actions';
import {tenant} from '../../../../lib/beta/db';
import {attestCapture,revokeCapture,captureConsents,takeDownClassRecording,captureTerms,captureTermsVersion,captureConsentEnabled} from '../../../../lib/beta/capture-consent';
export const runtime='nodejs';
// Capture is held behind a commissioning flag until recovery and full class
// workflows are qualified. Migration/build alone do not enable it for students.
async function handleGET(request:Request){try{
 classCaptureEnabled();const actor=await betaActor();if(!actor)throw new BetaHttpError('Please sign in.',401);classAccountMatches(request,actor.id,request.method==='POST');
 if(new URL(request.url).searchParams.get('consents')==='1')return betaJson({enabled:captureConsentEnabled(),terms:captureTerms,terms_version:captureTermsVersion,consents:await captureConsents(actor.id)});
 const id=new URL(request.url).searchParams.get('id');if(id){const record=await classRecording(actor.id,id);return betaJson({...record,actions_enabled:classActionsEnabled(),cornell:await tenant(actor.id,c=>classCornellView(c,actor.id,id))});}return betaJson(await listClassRecordings(actor.id));
}catch(error){return betaError(error);}}
async function handlePOST(request:Request){try{
 classCaptureEnabled();betaWriteAllowed(request);const actor=await betaActor();if(!actor)throw new BetaHttpError('Please sign in.',401);classAccountMatches(request,actor.id,request.method==='POST');
 const body=await betaRequestJson(request,3*1024*1024);
 if(body.action==='consent')return betaJson(await attestCapture(actor.id,body),201);
 if(body.action==='revoke_consent')return betaJson({revoked:await revokeCapture(actor.id,body.course_id)});
 if(body.action==='delete')return betaJson(await takeDownClassRecording(actor.id,body.id));
 if(body.action==='create')return betaJson(await createClassSession(actor.id,body),201);
 if(body.action==='seal'){const sealed=await sealClassRecording(actor.id,body.id,body.chunks,body.duration_ms,body);if(transcriptionEnabled()){try{await queueClassTranscription(actor.id,body.id);}catch{return betaJson({...sealed,transcription_hold:true});}}return betaJson(sealed);}
 if(body.action==='cornell')return betaJson(await queueClassCornell(actor.id,body.id,body.retry===true));
 if(body.action==='actions')return betaJson(await prepareClassActions(actor.id,body.id));
 if(body.action==='transcribe')return betaJson(await queueClassTranscription(actor.id,body.id,body.retry===true));
 if(body.action==='correct')return betaJson(await correctClassTranscript(actor.id,body.id,body));
 throw new BetaHttpError('Invalid class recording action.');
}catch(error){return betaError(error);}}

export const GET=betaRoute(handleGET);
export const POST=betaRoute(handlePOST);
