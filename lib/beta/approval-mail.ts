import {randomUUID} from 'node:crypto';
import {tenant,uuid} from './db';
import {betaOrigin,betaSecure} from './config';
import {BetaHttpError} from './http';
import {adminMailReady,deliverGmailMessage,MailDeliveryError,openGmail} from './admin-mail';
import {contactEmail,isAdminEmail,limit,recordAdmissionDecision,requireAdminSession,type AdminSession} from './admissions';
import {emailMessage,emailPart,renderEmailText,safeEmailUrl} from './email-design';
import {approvalEmail,emailLanguage} from './neyvu-emails';

// Approval email is opt-in. 'gmail' uses the existing Neyvu Gmail sender on the
// deployed HTTPS service only. 'log' is for local runs: it prints the message and
// delivers nothing. Anything else is off, and student copy keeps saying approval is manual.
export type ApprovalMailMode='gmail'|'log'|'off';
export function approvalMailMode():ApprovalMailMode{
 const setting=process.env.SCHOOL_BETA_APPROVAL_EMAIL,local=process.env.SCHOOL_BETA_LOCAL==='1';
 try{
  if(setting==='log'&&local)return 'log';
  if(setting==='gmail'&&!local&&betaSecure()&&adminMailReady())return 'gmail';
 }catch{}
 return 'off';
}
export type ApprovalTransport={kind:'gmail'|'log';send(recipient:string,message:string):Promise<void>};
export function approvalTransport(mode=approvalMailMode()):ApprovalTransport|null{
 if(mode==='gmail')return {kind:'gmail',async send(recipient,message){await deliverGmailMessage(openGmail(),recipient,message);}};
 if(mode==='log')return {kind:'log',async send(recipient,message){
  console.info('Neyvu approval email (log transport, not delivered) to '+recipient+'\n'+emailPart(message,'text/plain'));
 }};
 return null;
}

type ApprovalRequest={email:string;name:string;origin?:string;language?:string};
// The Mac download is an operator setting (Render env). A missing or unsafe value falls back to the
// private-link wording rather than blocking an approval email.
export function macDownloadUrl(){const value=process.env.SCHOOL_BETA_MAC_DOWNLOAD_URL;if(!value)return null;try{const url=safeEmailUrl(value);return url.startsWith('https://')?url:null;}catch{return null;}}
const approvalContent=(request:ApprovalRequest)=>approvalEmail({origin:betaOrigin(),email:contactEmail(request.email),name:request.name,invitation:request.origin==='invitation',language:emailLanguage(request.language),macUrl:macDownloadUrl()});
export function approvalMailText(request:ApprovalRequest){return renderEmailText(approvalContent(request).email);}
export function approvalMailMessage(request:ApprovalRequest){
 const email=contactEmail(request.email);
 if(isAdminEmail(email))throw Error('Invalid approval mail');
 const content=approvalContent(request);
 return emailMessage({to:email,subject:content.subject,messageId:randomUUID()+'@neyvu.invalid',email:content.email});
}

export type ApprovalMailResult={state:'sent'|'logged'|'failed'|'unknown'|'off'|'not-sent';message:string};
const unconfirmed='Delivery of the earlier attempt is unconfirmed. Check the Sent folder of the Neyvu Gmail sender before sending again.';

// Claim, send, then record. The claim commits before any network step and only one
// caller can win it, so concurrent requests cannot send twice. An attempt whose outcome
// is unknown is never retried automatically: the admin must confirm it did not arrive.
// Rows are reached only through admin-session definer functions (migrations 021 and 022).
const refused:Record<string,[string,number]>={
 unauthorized:['Sign in to the admin account.',401],'not-found':['Access request not found.',404],
 'not-approved':['Approve this request before sending its email.',409],sent:['The approval email was already sent. It will not be sent again.',409],
 sending:['The approval email is being sent now. Refresh requests in a minute.',409],unknown:[unconfirmed,409]};
export async function deliverApprovalMail(admin:AdminSession,id:unknown,options:{confirmUnknown?:boolean;transport?:ApprovalTransport|null}={}):Promise<ApprovalMailResult>{
 if(!isAdminEmail(admin.email))throw new BetaHttpError('Sign in to the admin account.',401);
 if(!uuid(id))throw new BetaHttpError('Choose an access request.');
 const transport=options.transport===undefined?approvalTransport():options.transport;
 if(!transport)return {state:'off',message:'Approval email is turned off, so no email was sent. Let the student know they can sign in.'};
 const request=await tenant(randomUUID(),async c=>{
  await limit(c,'approval-mail','all',40);
  const row=(await c.query('SELECT outcome,email,name,origin,attempt FROM schoolvault.admin_claim_approval_mail($1,$2,$3,$4)',[admin.hash,id,transport.kind,options.confirmUnknown===true])).rows[0];
  // Throwing here rolls back the claim and the limit together.
  if(row?.outcome!=='claimed'){const [message,status]=refused[row?.outcome]||['The approval email could not be prepared.',409];throw new BetaHttpError(message,status);}
  if(isAdminEmail(row.email))throw new BetaHttpError('Admin accounts cannot become students.');
  const language=(await c.query('SELECT schoolvault.admin_request_language($1,$2) AS language',[admin.hash,id])).rows[0]?.language;
  return {email:row.email as string,attempt:row.attempt as string,message:approvalMailMessage({...row,language})};
 });
 let outcome:'sent'|'failed'|'unknown'='sent';
 try{await transport.send(request.email,request.message);}
 catch(error){outcome=error instanceof MailDeliveryError&&error.accepted==='unknown'?'unknown':'failed';}
 let saved=false;
 try{saved=await tenant(randomUUID(),async c=>(await c.query('SELECT schoolvault.admin_record_approval_mail($1,$2,$3,$4,$5) AS saved',[admin.hash,id,outcome,randomUUID(),request.attempt])).rows[0].saved===true);}catch{}
 // An unsaved attempt stays 'sending' and turns 'unknown' after two minutes, which blocks resends.
 if(!saved)return outcome==='sent'?{state:'unknown',message:'The approval email was handed to Gmail, but its status could not be saved. Do not send it again.'}:{state:'unknown',message:unconfirmed};
 if(outcome==='sent')return transport.kind==='log'?{state:'logged',message:'Approval email written to the local server log. Nothing was delivered.'}:{state:'sent',message:'Approval email sent to '+request.email+'.'};
 if(outcome==='unknown')return {state:'unknown',message:'The approval email may not have been delivered. '+unconfirmed};
 return {state:'failed',message:'The approval email was not sent. Use Send approval email to try again.'};
}

export async function decideAdmissionWithEmail(id:unknown,decision:unknown){return decideAndNotify(await requireAdminSession(),id,decision);}
export async function sendApprovalMail(id:unknown,confirmUnknown:unknown){return deliverApprovalMail(await requireAdminSession(),id,{confirmUnknown:confirmUnknown===true});}
// The decision commits first. A mail problem is reported to the admin and never undoes it.
export async function decideAndNotify(admin:AdminSession,id:unknown,decision:unknown,transport?:ApprovalTransport|null){
 const result=await recordAdmissionDecision(admin,id,decision);
 if(result.status!=='approved')return result;
 try{return {...result,email:await deliverApprovalMail(admin,id,{transport})};}
 catch(error){
  const reason=error instanceof BetaHttpError?error.message:'Neyvu could not start sending it.';
  return {...result,email:{state:'not-sent',message:'The approval email was not sent. '+reason}};
 }
}
