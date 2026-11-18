import { NextRequest, NextResponse } from 'next/server';
import { accountFor, sameOrigin, pairCode, exchangeCode, cookieName, privateHost, primaryPrivateUrl } from '../../../lib/auth';
import { createNote, updateNote, setting, Conflict, audit, db } from '../../../lib/store';
import { workspace, answer, startJob, catalog, syncNote, searchSources,contextSources,saveAnswerNote } from '../../../lib/pilot';
import {createThread,selectThread,updateThread,archiveThread,chatPage,dismissTurn,intents,type ContextRef,type Intent} from '../../../lib/chats';
import {readSchool} from '../../../lib/data';
import { bridge } from '../../../lib/bridge';
import {boundedBody,BodyTooLarge} from '../../../lib/body';
export const runtime='nodejs';
export const dynamic='force-dynamic';
function response(data:unknown,status=200){return NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store'}});}
export async function GET(request:NextRequest){
  const account=await accountFor(request.headers.get('host'));if(!account)return response({error:'Pair this device from your desktop app'},401);
  try{return response(await workspace(account));}catch{return response({error:'Course evidence could not be loaded. Your saved notes are preserved.'},503);}
}
export async function POST(request:NextRequest){
  const host=request.headers.get('host');
  if(!sameOrigin(request)||!privateHost(host)||process.env.VERCEL)return response({error:'Request origin is not authorized'},403);
  if(Number(request.headers.get('content-length'))>200000)return response({error:'Request too large'},413);
  try{
    const raw=(await boundedBody(request,200000)).toString('utf8');
    const payload=JSON.parse(raw);if(!payload||typeof payload!=='object'||Array.isArray(payload))return response({error:'Invalid request'},400);
    if(payload.action==='login'){
      const token=exchangeCode(String(payload.code||''),host!);
      if(!token)return response({error:'Code expired or incorrect. Generate a new code on your desktop.'},401);
      const result=response({ok:true});result.cookies.set(cookieName,token,{httpOnly:true,sameSite:'strict',secure:request.headers.get('origin')?.startsWith('https://'),path:'/',maxAge:30*24*3600});return result;
    }
    const account=await accountFor(host);if(!account)return response({error:'This device is not paired'},401);
    const allowed=(await catalog()).courses.map(c=>c.code);
    if(payload.course&&!allowed.includes(payload.course))return response({error:'Unknown course'},400);
    const intent=payload.intent||'ask';if(!intents.includes(intent))return response({error:'Unknown assistant mode'},400);
    const refs=payload.context||[];
    if(!Array.isArray(refs)||refs.length>8||refs.some((r:any)=>!r||!['task','source','note'].includes(r.kind)||typeof r.id!=='string'||r.id.length>300))return response({error:'Choose up to eight valid context items'},400);
    switch(payload.action){
      case 'chat-create':return response(createThread(payload.course||'',intent,refs,account));
      case 'chat-open':return response(selectThread(String(payload.id),account));
      case 'chat-page':return response(chatPage(String(payload.id),account,payload.before));
      case 'chat-update':if(payload.title!==undefined&&(!String(payload.title).trim()||String(payload.title).length>120))return response({error:'Use a chat title under 120 characters'},400);return response(updateThread(String(payload.id),{...(payload.title!==undefined?{title:String(payload.title).trim()}:{}),...(payload.draft!==undefined?{draft:String(payload.draft).slice(0,3000),course:payload.course||'',intent,context:refs}:{})},account));
      case 'chat-archive':return response(archiveThread(String(payload.id),payload.archived!==false,account));
      case 'chat-dismiss':return response(dismissTurn(String(payload.id),String(payload.requestId),account));
      case 'chat-context':return response({sources:await contextSources(refs,await readSchool(),account)});
      case 'chat-save-note':if(!allowed.includes(payload.course))return response({error:'Choose a notebook course'},400);return response(saveAnswerNote(String(payload.messageId),payload.course,account));
      case 'chat': if(typeof payload.question!=='string'||!payload.question.trim()||payload.question.length>3000)return response({error:'Enter a question under 3,000 characters'},400);if(payload.requestId!==undefined&&(typeof payload.requestId!=='string'||!/^[a-f0-9-]{36}$/i.test(payload.requestId)))return response({error:'Invalid question request ID'},400);return response(await answer(payload.question,payload.course||'',account,request.signal,payload.requestId,{threadId:payload.threadId,intent,context:refs}));
      case 'note-create':if(!allowed.includes(payload.course))return response({error:'Choose a course'},400);return response(createNote(payload.course,String(payload.title||'Class notes').slice(0,180),String(payload.body||'').slice(0,80000),account));
      case 'note-save':if(typeof payload.body!=='string'||payload.body.length>80000)return response({error:'Note is too large'},400);return response(updateNote(payload.id,Number(payload.version),{body:payload.body,title:String(payload.title||'Class notes').slice(0,180),...(typeof payload.transcript==='string'?{transcript:payload.transcript.slice(0,200000)}:{})},account));
      case 'summary':return response(startJob(payload.id,'summary',account),202);
      case 'transcribe':return response(startJob(payload.id,'transcribe',account),202);
      case 'notion-sync':case 'notion-pull':{const result=await syncNote(payload.id,payload.action==='notion-pull'?'pull':'push',account);return response(result,result.conflict?409:200);}
      case 'permission':setting('recording:'+payload.course,payload.allowed?'permitted':'not_confirmed',account);audit('recording-permission',payload.course,account);return response({ok:true});
      case 'pair':if(!/^(127\.0\.0\.1|localhost):3213$/.test(host!))return response({error:'Pairing codes are created on the host desktop'},403);return response({code:pairCode(),url:primaryPrivateUrl()});
      case 'unpair-all':if(!/^(127\.0\.0\.1|localhost):3213$/.test(host!))return response({error:'Revoke paired devices from the host desktop'},403);db().prepare('DELETE FROM sessions WHERE account=?').run(account);db().prepare('DELETE FROM pairs WHERE account=?').run(account);audit('devices-unpaired',account,account);return response({ok:true});
      case 'search':return response(await searchSources(String(payload.query||'').slice(0,3000),payload.course||'',account,true));
      default:return response({error:'Unknown action'},400);
    }
  }catch(error){return response({error:error instanceof Error?error.message:'Request could not be completed'},error instanceof BodyTooLarge?413:error instanceof Conflict?409:400);}
}
