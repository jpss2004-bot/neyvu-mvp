// Server configuration only. Never use request Host as a backend destination.
function origin(raw:string|undefined,localPorts:string[]){
 if(!raw)throw Error('Frontend service origin is not configured');
 const u=new URL(raw),local=process.env.NEYVU_LOCAL_SPLIT==='1'&&u.protocol==='http:'&&u.hostname==='127.0.0.1'&&localPorts.includes(u.port);
 if(u.protocol!=='https:'&&!local||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('Invalid frontend service origin');
 return u.origin;
}
export function frontendOrigin(){return origin(process.env.NEYVU_WEB_ORIGIN,['3342']);}
export function backendOrigin(){const value=origin(process.env.NEYVU_API_ORIGIN,['3340']);if(value===frontendOrigin())throw Error('Frontend cannot proxy to itself');return value;}
