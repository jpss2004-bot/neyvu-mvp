import {randomUUID} from 'node:crypto';
import {betaPool,tenant,uuid} from './db';
import {contactEmail,isAdminEmail,limit,requireAdminSession,type AdminSession} from './admissions';
import {deliverApprovalMail,type ApprovalTransport} from './approval-mail';
import {BetaHttpError} from './http';

export async function studentList(){const admin=await requireAdminSession();return listStudents(admin);}
export async function listStudents(admin:AdminSession){
 if(!isAdminEmail(admin.email))throw new BetaHttpError('Sign in to the admin account.',401);
 return (await betaPool().query('SELECT * FROM schoolvault.admin_students($1)',[admin.hash])).rows;
}
export async function inviteStudent(body:Record<string,unknown>){return inviteWithSession(await requireAdminSession(),body);}
export async function inviteWithSession(admin:AdminSession,body:Record<string,unknown>,transport?:ApprovalTransport|null){
 if(!isAdminEmail(admin.email))throw new BetaHttpError('Sign in to the admin account.',401);
 const email=contactEmail(body.email),name=typeof body.name==='string'?body.name.trim():'';
 if(isAdminEmail(email))throw new BetaHttpError('Admin accounts cannot become students.');
 if(!name||name.length>100||/[\x00-\x1f]/.test(name))throw new BetaHttpError('Enter the student’s name, up to 100 characters.');
 if(body.eligibility_confirmed!==true)throw new BetaHttpError('Confirm that you reviewed this student’s eligibility.');
 const row=await tenant(randomUUID(),async c=>{
  await limit(c,'admin-invite','all',20);
  const invited=(await c.query('SELECT * FROM schoolvault.admin_invite_student($1,$2,$3,$4,$5)',[admin.hash,randomUUID(),email,name,randomUUID()])).rows[0];
  // A new invitation takes the email language the admin chose; an existing record keeps its own.
  if(invited?.outcome==='invited')await c.query('SELECT schoolvault.admin_set_request_language($1,$2,$3)',[admin.hash,invited.id,body.language==='es'?'es':'en']);
  return invited;
 });
 if(!['invited','existing'].includes(row?.outcome)){
  const errors:Record<string,[string,number]>={unauthorized:['Sign in to the admin account.',401],suspended:['This student is suspended. Review Students before restoring access.',409],disabled:['This account is disabled and needs a separate review.',409],'decision-required':['This email already has an access request. Review that decision instead.',409]};
  const [message,status]=errors[row?.outcome]||['The invitation could not be created.',409];throw new BetaHttpError(message,status);
 }
 // Repeated requests reuse the original record and mail claim. They cannot reset delivery.
 let delivery;
 try{delivery=await deliverApprovalMail(admin,row.id,{transport});}
 catch(error){delivery={state:'not-sent',message:error instanceof Error?error.message:'Refresh Students before retrying delivery.'};}
 return {id:row.id,status:row.outcome,email:delivery,message:row.outcome==='invited'?'Access created for this Google account.':'This student already has access.'};
}
export async function changeStudentAccess(body:Record<string,unknown>){return setStudentAccess(await requireAdminSession(),body.id,body.state);}
export async function setStudentAccess(admin:AdminSession,id:unknown,state:unknown){
 if(!isAdminEmail(admin.email))throw new BetaHttpError('Sign in to the admin account.',401);
 if(!uuid(id)||!['active','suspended'].includes(String(state)))throw new BetaHttpError('Choose a student and access state.');
 const outcome=await tenant(randomUUID(),async c=>{
  await limit(c,'admin-access','all',40);
  return (await c.query('SELECT schoolvault.admin_set_student_access($1,$2,$3,$4) AS outcome',[admin.hash,id,state,randomUUID()])).rows[0].outcome;
 });
 if(outcome==='unauthorized')throw new BetaHttpError('Sign in to the admin account.',401);
 if(outcome==='not-found')throw new BetaHttpError('Approved student not found.',404);
 if(outcome==='disabled')throw new BetaHttpError('This account was already disabled and needs a separate review.',409);
 if(!['active','suspended','unchanged'].includes(outcome))throw new BetaHttpError('Access could not be changed.',409);
 return {state,message:state==='suspended'?'Access suspended. Sessions and Companion connections revoked; queued work cancelled. Saved study data is retained.':'Access restored. The student must sign in again and reconnect their Companion. Previous sessions remain revoked.'};
}
