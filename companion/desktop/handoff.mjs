import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
export const ORIGIN='https://neyvu-app.example.com';
// ORIGIN stays the API for native calls. The browser hand-off follows the website address the API reports,
// so moving the website (Vercel cutover, a later domain) needs no Store release. Only a bare https origin is accepted.
export function webOrigin(value){if(typeof value!=='string')return null;try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash&&u.origin===value?u.origin:null;}catch{return null;}}
export async function createHandoff(accept,{origin=ORIGIN,lifetime=600000}={}){
 const nonce=randomBytes(32).toString('base64url');let used=false,busy=false;
 const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'");
  const reply=(status,message)=>{res.writeHead(status,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><title>Neyvu</title><main style="font:18px system-ui;max-width:34rem;margin:12vh auto;padding:24px"><h1>Neyvu</h1><p>'+message+'</p></main>');};
  if(req.url!=='/connect'||req.method!=='POST'||req.headers.origin!==origin||!req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')){reply(403,'This connection was not requested by Neyvu.');return;}
  let body='';try{for await(const part of req){body+=part.toString();if(body.length>2000)throw Error('Too large');}}catch{reply(400,'The connection request could not be read. Return to the companion and try again.');return;}
  const fields=new URLSearchParams(body),state=fields.get('state')||'',code=fields.get('code')||'';
  if(used||busy||state.length!==nonce.length||!timingSafeEqual(Buffer.from(state),Buffer.from(nonce))||!/^[A-Za-z0-9_-]{43}$/.test(code)){reply(403,'This connection expired or has already been used. Return to the companion and try again.');return;}
  busy=true;
  try{await accept(code);used=true;reply(200,'Account connected. Return to the Neyvu Companion window to sign in to Moodle.');clearTimeout(timer);setTimeout(()=>server.close(),1000).unref();}
  catch{reply(502,'Neyvu could not finish connecting. Return to the companion and choose Connect account again.');}finally{busy=false;}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const port=server.address().port;
 const timer=setTimeout(()=>server.close(),lifetime);timer.unref();
 return {url:origin+'/beta/auth/start?port='+port+'&state='+nonce,close:()=>{clearTimeout(timer);server.close();},port,state:nonce};
}

// Redeem failures must appear in the companion as well as the loopback response.
export async function pairWithStatus(engine,code){try{return await engine.pair(code);}catch(error){engine.fail(error);throw error;}}
