import {createHash} from 'node:crypto';
import {BetaHttpError} from './http';

const kinds=new Set(['det','inverse','rref','system','rank','eigen','nullspace','transpose','product','parameters','check','setup','consistency','pivots','counterexample']);
const elimination=new Set(['rref','system','rank','nullspace','consistency','pivots']);
export type CalculationRecord={schema:1;kind:'exact-calculation';scope:'listed-calculations-only';question_sha256:string;answer_sha256:string;computed_at:string;number_system:{kind:'ordinary-exact'|'prime-field'|'integer-ring';modulus:number|null};engine:{name:'sympy';version:string;source_sha256:string};calculations:{kind:string;summary:string;steps:string[]}[]};
const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
const isHash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const object=(value:any,keys:string[])=>!!value&&!Array.isArray(value)&&typeof value==='object'&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const prime=(n:number)=>{for(let i=2;i*i<=n;i++)if(n%i===0)return false;return n>=2;};

// The lease-authenticated worker supplies computations. The web server checks
// shape and bindings; it does not independently recompute or certify the prose.
export function calculationRecord(raw:unknown,question:string,answer:string):CalculationRecord|undefined{
 if(raw===undefined)return undefined; // older answers have no calculation record
 const fail=()=>{throw new BetaHttpError('Invalid calculation record');};
 let encoded:string;try{encoded=JSON.stringify(raw);}catch{return fail();}
 if(!encoded||Buffer.byteLength(encoded)>32768)return fail();
 const value=raw as CalculationRecord;
 if(!object(value,['schema','kind','scope','question_sha256','answer_sha256','computed_at','number_system','engine','calculations'])||value.schema!==1||value.kind!=='exact-calculation'||value.scope!=='listed-calculations-only')return fail();
 if(!isHash(value.question_sha256)||!isHash(value.answer_sha256)||value.question_sha256!==sha(question)||value.answer_sha256!==sha(answer.trim()))return fail();
 if(typeof value.computed_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.computed_at)||!Number.isFinite(Date.parse(value.computed_at))||new Date(value.computed_at).toISOString()!==value.computed_at)return fail();
 if(!object(value.engine,['name','version','source_sha256'])||value.engine.name!=='sympy'||typeof value.engine.version!=='string'||!/^\d+\.\d+(?:\.\d+)?$/.test(value.engine.version)||value.engine.version.length>30||!isHash(value.engine.source_sha256))return fail();
 const system=value.number_system;
 if(!object(system,['kind','modulus']))return fail();
 if(system.kind==='ordinary-exact'){if(system.modulus!==null)return fail();}
 else{
  const modulus=system.modulus;
  if(!['prime-field','integer-ring'].includes(system.kind)||typeof modulus!=='number'||!Number.isSafeInteger(modulus)||modulus<2||modulus>9999||(system.kind==='prime-field')!==prime(modulus))return fail();
 }
 if(!Array.isArray(value.calculations)||value.calculations.length<1||value.calculations.length>8)return fail();
 for(const item of value.calculations){
  if(!object(item,['kind','summary','steps'])||!kinds.has(item.kind)||typeof item.summary!=='string'||!item.summary.trim()||item.summary.length>4000||!answer.includes(item.summary)||!Array.isArray(item.steps)||item.steps.length>128||item.steps.some(step=>typeof step!=='string'||!step.trim()||step.length>512))return fail();
  if(system.modulus!==null&&elimination.has(item.kind)&&(system.kind!=='prime-field'||system.modulus>997))return fail();
 }
 // Return only reviewed fields, detached from the incoming object.
 return JSON.parse(encoded) as CalculationRecord;
}

export function calculationRecordText(record:CalculationRecord){
 const arithmetic=record.number_system.modulus===null?'Ordinary exact arithmetic; no modulus was declared.':`Arithmetic modulo ${record.number_system.modulus} (${record.number_system.kind==='prime-field'?'prime field':'integer ring'}).`;
 return ['Calculation record for the original generated answer',
  'Only the listed calculations were computed. Original assignment wording, course requirements and later edits are not checked by this record.',
  arithmetic,`Computed at ${record.computed_at}.`,
  ...record.calculations.map((item,index)=>`${index+1}. ${item.summary}`),
 ].join('\n\n');
}
