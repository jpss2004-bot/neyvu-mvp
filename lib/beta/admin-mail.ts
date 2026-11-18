import {connect,type TLSSocket} from 'node:tls';
import {randomUUID} from 'node:crypto';
import {betaOrigin} from './config';
import {contactEmail,isAdminEmail} from './admissions';
import {emailMessage} from './email-design';
import {adminSignInEmail} from './neyvu-emails';

// Small, bounded SMTP client for the selected Gmail sender only. No arbitrary relay,
// recipients, attachments, student mail scopes, or disabled certificate validation.
// Callers choose recipients from admin settings or approved access requests only.
export class MailDeliveryError extends Error{
 // 'no': Gmail cannot have accepted the message. 'unknown': it was handed over and may
 // have been accepted, so an automatic retry could deliver a second copy.
 constructor(public accepted:'no'|'unknown'){super('Email delivery failed');}
}
export function adminMailReady(){return process.env.SCHOOL_BETA_SMTP_USER==='neyvu.support@example.com'&&/^[a-z]{16}$/.test((process.env.SCHOOL_BETA_SMTP_PASSWORD||'').replace(/ /g,''));}
export function adminMailMessage(email:string,token:string){
 if(!isAdminEmail(contactEmail(email))||!/^[A-Za-z0-9_-]{43}$/.test(token))throw Error('Invalid admin mail');
 const content=adminSignInEmail({origin:betaOrigin(),link:betaOrigin()+'/beta/admin/confirm#'+token});
 return emailMessage({to:email,subject:content.subject,messageId:randomUUID()+'@neyvu.invalid',email:content.email});
}
class Replies {
 private buffer='';private lines:string[]=[];private queued:Array<{code:number;lines:string[]}>=[];
 private waiting?:{resolve:(value:{code:number;lines:string[]})=>void;reject:(error:Error)=>void};private failure?:Error;
 constructor(private socket:TLSSocket){
  socket.setEncoding('utf8');socket.on('data',chunk=>this.receive(String(chunk)));
  socket.on('error',()=>this.fail());socket.on('close',()=>this.fail());
 }
 private fail(){this.failure=Error('Admin email delivery failed');this.waiting?.reject(this.failure);this.waiting=undefined;}
 private receive(chunk:string){
  this.buffer+=chunk;if(this.buffer.length+this.lines.join('').length>16384){this.socket.destroy();this.fail();return;}
  while(this.buffer.includes('\r\n')){
   const at=this.buffer.indexOf('\r\n'),line=this.buffer.slice(0,at);this.buffer=this.buffer.slice(at+2);
   if(!/^\d{3}[ -]/.test(line)||this.lines.length&&line.slice(0,3)!==this.lines[0].slice(0,3)){this.socket.destroy();this.fail();return;}
   this.lines.push(line);
   if(line[3]===' '){const reply={code:Number(line.slice(0,3)),lines:this.lines};this.lines=[];
    if(this.waiting){const waiter=this.waiting;this.waiting=undefined;waiter.resolve(reply);}else this.queued.push(reply);
    if(this.queued.length>10){this.socket.destroy();this.fail();return;}
   }
  }
 }
 next(){if(this.failure)return Promise.reject(this.failure);if(this.queued.length)return Promise.resolve(this.queued.shift()!);return new Promise<{code:number;lines:string[]}>((resolve,reject)=>{if(this.waiting)return reject(Error('Concurrent SMTP command'));this.waiting={resolve,reject};});}
 async command(command:string,expected:number[]){
  if(/[\r\n]/.test(command))throw Error('Invalid SMTP command');
  this.socket.write(command+'\r\n');const result=await this.next();if(!expected.includes(result.code))throw Error('Admin email delivery failed');return result;
 }
}
async function authenticateGmail(replies:Replies){
 const greeting=await replies.next();if(greeting.code!==220)throw Error('Admin email delivery failed');
 const capabilities=await replies.command('EHLO schoolvault.invalid',[250]);
 if(!capabilities.lines.some(line=>/^250[ -]AUTH\b.*\bPLAIN\b/i.test(line)))throw Error('SMTP authentication unavailable');
 const credential=Buffer.from('\0'+process.env.SCHOOL_BETA_SMTP_USER+'\0'+process.env.SCHOOL_BETA_SMTP_PASSWORD!.replace(/ /g,''),'utf8').toString('base64');
 await replies.command('AUTH PLAIN '+credential,[235]);
}
export async function verifyAdminMailTransport(){
 if(!adminMailReady())throw Error('Admin email is not configured');
 const socket=openGmail(),replies=new Replies(socket),deadline=setTimeout(()=>socket.destroy(Error('SMTP timeout')),15000);
 try{await authenticateGmail(replies);socket.end('QUIT\r\n');return {authenticated:true,email_sent:false};}
 finally{clearTimeout(deadline);socket.destroy();}
}
export function openGmail(){
 // Tests and fixtures use synthetic sockets; the test runner never reaches Gmail.
 if(process.env.NODE_TEST_CONTEXT)throw Error('Real email is disabled during tests');
 return connect({host:'smtp.gmail.com',port:465,servername:'smtp.gmail.com',rejectUnauthorized:true,minVersion:'TLSv1.2'});
}
export async function sendAdminLoginMail(email:string,token:string){
 if(!adminMailReady())throw Error('Admin email is not configured');
 adminMailMessage(email,token); // Validate before opening a network connection.
 return deliverAdminLoginMail(openGmail(),email,token);
}
// The transport is factored for protocol tests using a synthetic socket. The
// production caller above fixes Gmail, TLS, certificate checks and port 465.
export async function deliverAdminLoginMail(socket:TLSSocket,email:string,token:string){
 if(!adminMailReady())throw Error('Admin email is not configured');
 return deliverGmailMessage(socket,email,adminMailMessage(email,token));
}
export async function deliverGmailMessage(socket:TLSSocket,recipient:string,message:string){
 if(!adminMailReady()){socket.destroy();throw new MailDeliveryError('no');}
 const replies=new Replies(socket),deadline=setTimeout(()=>socket.destroy(Error('SMTP timeout')),15000);
 let handedOver=false;
 try{
  await authenticateGmail(replies);
  await replies.command('MAIL FROM:<neyvu.support@example.com>',[250]);
  await replies.command('RCPT TO:<'+recipient+'>',[250]);await replies.command('DATA',[354]);
  socket.write(message+'\r\n.\r\n');handedOver=true;
  // A lost reply leaves acceptance unknown; an explicit non-250 reply means rejected.
  const reply=await replies.next();if(reply.code!==250){handedOver=false;throw Error('Email delivery failed');}
  // Acceptance is enough; QUIT failure cannot revoke a message already accepted.
  socket.end('QUIT\r\n');
 }catch{throw new MailDeliveryError(handedOver?'unknown':'no');}
 finally{clearTimeout(deadline);socket.destroy();}
}
