export const reportStages=['setup','moodle','sources','answer','notes','calendar','other'] as const;
export const reportOutcomes=['worked','blocked','missing','incorrect','slow','confusing'] as const;
export const reportDevices=['windows','mac-silicon','mac-intel','iphone-ipad','other'] as const;
export const reportElapsed=['not-measured','under-10s','10-60s','1-5min','over-5min'] as const;
export const stageNames={setup:'Getting started',moodle:'Connecting or importing Moodle',sources:'Reading course material',answer:'Assistant answer',notes:'Notebook',calendar:'Planning and calendar',other:'Something else'};
export const outcomeNames={worked:'Worked well',blocked:'Could not continue',missing:'Missing information',incorrect:'Incorrect result',slow:'Too slow',confusing:'Hard to understand'};
export const deviceNames={windows:'Windows', 'mac-silicon':'Mac with Apple Silicon','mac-intel':'Mac with Intel','iphone-ipad':'iPhone or iPad',other:'Other'};
export const elapsedNames={'not-measured':'Not measured','under-10s':'Under 10 seconds','10-60s':'10 seconds to 1 minute','1-5min':'1 to 5 minutes','over-5min':'Over 5 minutes'};
export function parsePilotReport(body:Record<string,unknown>){
 const keys=['id','consent','stage','outcome','device','elapsed','description'];
 if(Object.keys(body).some(key=>!keys.includes(key)))throw Error('Invalid report fields.');
 if(body.consent!==true)throw Error('Choose to share this report with the Neyvu owner.');
 if(typeof body.id!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.id))throw Error('Invalid report identifier.');
 const choice=(key:string,options:readonly string[])=>{if(typeof body[key]!=='string'||!options.includes(body[key] as string))throw Error('Choose a valid '+key+'.');return body[key] as string;};
 if(typeof body.description!=='string'||body.description.length>1200||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(body.description))throw Error('Enter a report of up to 1200 characters.');
 const description=body.description.trim();
 if(!description&&body.outcome!=='worked')throw Error('Describe what you expected and what happened.');
 return {id:body.id,stage:choice('stage',reportStages),outcome:choice('outcome',reportOutcomes),device:choice('device',reportDevices),elapsed:choice('elapsed',reportElapsed),description};
}
