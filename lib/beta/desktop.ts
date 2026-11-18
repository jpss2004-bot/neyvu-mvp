export const desktopReturnCookie='schoolvault-desktop-return';
export function desktopTarget(port:unknown,state:unknown){
 if(typeof port!=='string'||!/^[0-9]{4,5}$/.test(port)||Number(port)<1024||Number(port)>65535||typeof state!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(state))return null;
 return '/beta/desktop-connect?'+new URLSearchParams({port,state}).toString();
}

export const guidedSetupTarget='/beta?tab=setup';
export const todayCoverageTarget='/beta?tab=today&coverage=1';
// Only these local destinations may survive ordinary web sign-in.
export function setupReturnTarget(value:unknown){return value===guidedSetupTarget||value===todayCoverageTarget?value:null;}
export function setupSignInErrorUrl(origin:string,target:unknown,code:string){
 const url=new URL(setupReturnTarget(target)||'/beta',origin);
 url.searchParams.set('error',code);
 return url;
}
export const setupReturnCookie='neyvu-setup-return';
