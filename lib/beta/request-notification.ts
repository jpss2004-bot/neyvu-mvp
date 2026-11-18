import {randomUUID} from 'node:crypto';
import {adminEmails,contactEmail,isAdminEmail,limit,requireAdminSession} from './admissions';
import {adminMailReady,deliverGmailMessage,MailDeliveryError,openGmail} from './admin-mail';
import {betaOrigin,betaSecure} from './config';
import {tenant,uuid} from './db';
import {BetaHttpError} from './http';
import {emailMessage} from './email-design';
import {emailLanguage,requestNoticeEmail} from './neyvu-emails';
export type RequestNotice={id:string;attempt:string;recipient:string;name:string;email:string;language?:string};
export function requestNoticeRecipient(){
 const configured=process.env.SCHOOL_BETA_REQUEST_NOTIFY_EMAIL;
 const email=configured?contactEmail(configured):adminEmails().length===1?adminEmails()[0]:null;
 return email&&isAdminEmail(email)?email:null;
}
export function requestNoticeMessage(notice:RequestNotice){
 if(!isAdminEmail(contactEmail(notice.recipient))||!uuid(notice.id)||!uuid(notice.attempt))throw Error('Invalid request notification');
 const content=requestNoticeEmail({origin:betaOrigin(),name:notice.name,email:contactEmail(notice.email),id:notice.id,language:emailLanguage(notice.language)});
 return emailMessage({to:notice.recipient,subject:content.subject,messageId:'request-'+notice.attempt+'@neyvu.invalid',email:content.email});
}
export async function sendRequestNotice(notice:RequestNotice,dependencies?:{send:(recipient:string,message:string)=>Promise<void>;record:(state:'sent'|'failed'|'unknown')=>Promise<boolean>}){
 let state:'sent'|'failed'|'unknown'='sent';
 try{
  const message=requestNoticeMessage(notice);
  if(dependencies)await dependencies.send(notice.recipient,message);
  else{if(process.env.SCHOOL_BETA_LOCAL==='1'||!betaSecure()||!adminMailReady())throw new MailDeliveryError('no');await deliverGmailMessage(openGmail(),notice.recipient,message);}
 }catch(error){state=error instanceof MailDeliveryError&&error.accepted==='unknown'?'unknown':'failed';}
 try{
  const saved=dependencies?await dependencies.record(state):await tenant(randomUUID(),async c=>(await c.query('SELECT schoolvault.record_request_notice($1,$2,$3) AS saved',[notice.id,notice.attempt,state])).rows[0].saved===true);
  if(!saved)return 'unknown';
 }catch{return 'unknown';}
 return state;
}
export async function retryRequestNotice(id:unknown,confirmUnknown:unknown){
 const actor=await requireAdminSession(),recipient=requestNoticeRecipient();
 if(!uuid(id))throw new BetaHttpError('Choose an access request.');
 if(!recipient)throw new BetaHttpError('The request notification recipient is not configured.',503);
 const claimed=await tenant(randomUUID(),async c=>{await limit(c,'request-notice-retry','all',20);const row=(await c.query('SELECT * FROM schoolvault.admin_retry_request_notice($1,$2,$3,$4)',[actor.hash,id,recipient,confirmUnknown===true])).rows[0];return row&&{...row,language:(await c.query('SELECT schoolvault.admin_request_language($1,$2) AS language',[actor.hash,id])).rows[0]?.language};});
 if(!claimed)throw new BetaHttpError('This notification cannot be retried. Refresh its delivery status first.',409);
 const state=await sendRequestNotice({id,recipient,...claimed});
 return {state,message:state==='sent'?'Request notification handed to Gmail for delivery to '+recipient+'.':state==='failed'?'Notification failed. The student request is still saved.':'Delivery is unconfirmed. Check your inbox and the sender’s Sent folder before retrying.'};
}
