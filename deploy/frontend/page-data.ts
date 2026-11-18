import 'server-only';
import {boundedPageJson} from '../../lib/beta/page-response';
import {cookies} from 'next/headers';
import {parsePageCapabilities,parsePageSession} from '../../lib/beta/page-contract';
import type {StudyCopy} from '../../lib/beta/study-copy';
import {frontendOrigin,backendOrigin} from './transport-config';
export {frontendOrigin as pageOrigin};
async function read(view:string,message?:string){
 const url=new URL('/api/beta/page-data',backendOrigin());url.searchParams.set('view',view);if(message)url.searchParams.set('message',message);
 const jar=await cookies(),headers=new Headers({Accept:'application/json'});
 // Forward only the two session cookies, never every frontend/proxy cookie.
 const session=['schoolvault-session','schoolvault-admin'].map(name=>{const v=jar.get(name)?.value;return v&&/^[A-Za-z0-9_-]{43}$/.test(v)?name+'='+v:null;}).filter(Boolean).join('; ');
 if(session)headers.set('Cookie',session);
 const key=process.env.NEYVU_GATEWAY_KEY;if(key)headers.set('x-neyvu-gateway',key);
 const response=await fetch(url,{headers,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
 return boundedPageJson(response);
}
export async function pageCapabilities(){return parsePageCapabilities(await read('capabilities'));}
export async function pageSession(){return parsePageSession(await read('session'));}
export async function pageStudyCopy(message:string):Promise<StudyCopy>{
 if(!/^[a-f0-9-]{36}$/i.test(message))throw Error('Invalid answer');
 const data=await read('study',message) as {version?:number;copy?:StudyCopy};if(data?.version!==1||data?.copy?.message_id!==message)throw Error('Invalid study response');return data.copy;
}
