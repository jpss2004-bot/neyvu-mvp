// Public page data only. No database, environment or framework imports.
export const pageContractVersion=1;
export type PageCapabilities={version:1;accessReady:boolean;signInReady:boolean;adminReady:boolean;demoAvailable:boolean;localAccountAvailable:boolean;captureEnabled:boolean;approvalEmail:boolean};
export type PageActor={id:string;name:string;email:string;timezone:string;demo?:boolean};
export type PageSession={version:1;actor:PageActor|null;admin:{email:string}|null};
export const unavailableCapabilities:PageCapabilities={version:1,accessReady:false,signInReady:false,adminReady:false,demoAvailable:false,localAccountAvailable:false,captureEnabled:false,approvalEmail:false};
export function parsePageCapabilities(value:unknown):PageCapabilities{
 if(!value||typeof value!=='object'||(value as any).version!==pageContractVersion)throw Error('Unsupported page contract');
 const result={...unavailableCapabilities};
 for(const key of Object.keys(result).filter(k=>k!=='version')){if(typeof (value as any)[key]!=='boolean')throw Error('Invalid page capability');(result as any)[key]=(value as any)[key];}
 return result;
}
export function parsePageSession(value:unknown):PageSession{
 const v=value as any;
 if(!v||v.version!==pageContractVersion||!Object.hasOwn(v,'actor')||!Object.hasOwn(v,'admin'))throw Error('Unsupported session contract');
 let actor:PageActor|null=null,admin:{email:string}|null=null;
 if(v.actor!==null){const a=v.actor;
  if(!a||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(a.id)||['name','email','timezone'].some(k=>typeof a[k]!=='string'||a[k].length>254)||typeof a.demo!=='boolean')throw Error('Invalid session actor');
  actor={id:a.id,name:a.name,email:a.email,timezone:a.timezone,demo:a.demo};
 }
 if(v.admin!==null){if(!v.admin||typeof v.admin.email!=='string'||v.admin.email.length>254)throw Error('Invalid admin actor');admin={email:v.admin.email};}
 return {version:1,actor,admin};
}
