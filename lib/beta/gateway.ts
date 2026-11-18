import {timingSafeEqual} from 'node:crypto';
import {isIP} from 'node:net';
export function splitMode(){return process.env.SCHOOL_BETA_SPLIT_MODE==='1';}
export function trustedGateway(request:Request){
 const key=process.env.SCHOOL_BETA_GATEWAY_KEY,provided=request.headers.get('x-neyvu-gateway');
 return Boolean(key&&/^[A-Za-z0-9_-]{43,128}$/.test(key)&&provided&&/^[A-Za-z0-9_-]{43,128}$/.test(provided)&&provided.length===key.length&&timingSafeEqual(Buffer.from(provided),Buffer.from(key)));
}
export function browserGatewayAllowed(request:Request){
 if(!splitMode())return true;
 const u=new URL(request.url);
 if(u.pathname==='/api/beta/health')return true;
 // These routes retain their own existing bearer / one-use pairing authorization.
 // Cookie-based Companion browser actions still require the gateway.
 if(u.pathname==='/api/beta/worker'&&!request.headers.has('origin'))return true;
 if(u.pathname==='/api/beta/companion'&&request.method==='POST'&&!request.headers.has('origin')&&(request.headers.has('authorization')||u.searchParams.get('op')==='redeem'))return true;
 return trustedGateway(request);
}
export function gatewayPeer(request:Request){
 if(!trustedGateway(request))return null;
 const ip=request.headers.get('x-neyvu-client-ip')||'';return isIP(ip)?ip:'unknown-gateway-peer';
}
