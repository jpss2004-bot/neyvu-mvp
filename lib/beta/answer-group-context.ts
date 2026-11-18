import type {PoolClient} from 'pg';
import {isDeepStrictEqual} from 'node:util';
import {courseGroupContexts} from './group-context';
import type {GroupContext} from './group-context-format';
import {receiptsForSources} from './moodle-receipts';

// This projection is built by the server, never accepted from a question/upload.
// Course membership and personal reports do not establish activity applicability.
export async function answerGroupContext(c:PoolClient,user:string,courses:string[],now=new Date()):Promise<GroupContext[]>{
 const ids=[...new Set(courses)].sort();
 const groups=await courseGroupContexts(c,user,ids,now);
 return ids.map(id=>groups[id]);
}
export async function answerGroupsCurrent(c:PoolClient,user:string,pinned:GroupContext[]|undefined,now=new Date(),sources:any[]=[]){
 // Leases prepared by the prior compatible web release have no projection.
 if(pinned===undefined)return true;
 if(!Array.isArray(pinned)||pinned.length>40||pinned.some(g=>!g||typeof g.course_id!=='string'))return false;
 const current=await answerGroupContext(c,user,pinned.map(g=>g.course_id),now);
 // jsonb reorders object keys; PostgreSQL also returns timestamps as Dates.
 // Compare JSON values, not their serialization order.
 const jsonEqual=(a:unknown,b:unknown)=>isDeepStrictEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)));
 if(!jsonEqual(current,pinned))return false;
 const refs=sources.filter(s=>s.kind==='moodle'),receipts=await receiptsForSources(c,user,refs,now);
 return refs.every(s=>jsonEqual(receipts.get(s.id)||null,s.receipt||null));
}
