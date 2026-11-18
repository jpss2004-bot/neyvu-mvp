import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {uuid} from './db';
import {BetaHttpError} from './http';
import {checkHistory} from './budget';

const action='moodle-current-courses-confirmed';
const numeric=(value:unknown):value is string=>typeof value==='string'&&/^[1-9]\d{0,11}$/.test(value);
export type CurrentCourseSelection={confirmed:boolean;revision:string|null;moodle_ids:string[];reviewed_at:string|null;selection_source:'moodle-inprogress'|'user-reviewed'|null};
export type CurrentCourseReview={identity:string;identity_key:string;moodle_ids:string[];reviewed_at:string;selection_source:'moodle-inprogress'|'user-reviewed';expected_revision?:string|null};
const empty=():CurrentCourseSelection=>({confirmed:false,revision:null,moodle_ids:[],reviewed_at:null,selection_source:null});
export function validateCurrentCourseReview(raw:any,now=Date.now()):CurrentCourseReview{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(key=>!['identity','course_ids','reviewed_at','selection_source','expected_revision'].includes(key)))throw new BetaHttpError('Invalid current course review.');
 const identity=raw.identity,match=typeof identity==='string'&&identity.length<=180?identity.match(/^moodle-user:([1-9]\d{0,11})(?:\s*·\s*[^\r\n]{1,120})?$/):null;
 if(!match)throw new BetaHttpError('Confirm a stable Moodle account before reviewing courses.');
 if(!Array.isArray(raw.course_ids)||!raw.course_ids.length||raw.course_ids.length>40||raw.course_ids.some((id:unknown)=>!numeric(id))||new Set(raw.course_ids).size!==raw.course_ids.length)throw new BetaHttpError('Choose one to forty different Moodle courses.');
 const reviewed=typeof raw.reviewed_at==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(raw.reviewed_at)?Date.parse(raw.reviewed_at):NaN;
 if(!Number.isFinite(reviewed)||new Date(reviewed).toISOString().slice(0,10)!==raw.reviewed_at.slice(0,10)||reviewed>now+60000||reviewed<now-86400000)throw new BetaHttpError('Review the current course list again; the review time is not current.');
 if(!['moodle-inprogress','user-reviewed'].includes(raw.selection_source)||raw.expected_revision!==undefined&&raw.expected_revision!==null&&!uuid(raw.expected_revision))throw new BetaHttpError('Invalid current course review.');
 return {identity,identity_key:match[1],moodle_ids:[...raw.course_ids].sort((a,b)=>a.localeCompare(b,'en',{numeric:true})),reviewed_at:new Date(reviewed).toISOString(),selection_source:raw.selection_source,...(raw.expected_revision===undefined?{}:{expected_revision:raw.expected_revision?.toLowerCase()??null})};
}
async function latest(c:PoolClient,user:string){return (await c.query('SELECT id,details FROM schoolvault.audit WHERE user_id=$1 AND action=$2 ORDER BY created_at DESC,id DESC LIMIT 1',[user,action])).rows[0];}
function selector(event:any):CurrentCourseSelection{
 const d=event?.details;
 if(!event||!uuid(event.id)||!d||!Array.isArray(d.moodle_ids)||!d.moodle_ids.length||d.moodle_ids.length>40||d.moodle_ids.some((id:unknown)=>!numeric(id))||new Set(d.moodle_ids).size!==d.moodle_ids.length||!numeric(d.identity_key)||!['moodle-inprogress','user-reviewed'].includes(d.selection_source)||typeof d.reviewed_at!=='string'||!Number.isFinite(Date.parse(d.reviewed_at)))return empty();
 return {confirmed:true,revision:event.id,moodle_ids:d.moodle_ids,reviewed_at:d.reviewed_at,selection_source:d.selection_source};
}
export async function currentCourseSelection(c:PoolClient,user:string):Promise<CurrentCourseSelection>{return selector(await latest(c,user));}
// Caller holds the vault lock and validates the live device and pinned account.
// Each review is an append-only event; dates never change or delete old imports.
export async function saveCurrentCourseSelection(c:PoolClient,user:string,device:string,review:CurrentCourseReview){
 const event=await latest(c,user),current=selector(event);
 if(current.confirmed&&event.details.identity_key===review.identity_key&&current.reviewed_at===review.reviewed_at&&JSON.stringify(current.moodle_ids)===JSON.stringify(review.moodle_ids))return current;
 if(current.confirmed&&(review.expected_revision!==current.revision||Date.parse(review.reviewed_at)<=Date.parse(current.reviewed_at!)))throw new BetaHttpError('The current course selection changed. Check the latest selection and review it again.',409);
 if(!current.confirmed&&review.expected_revision!==undefined&&review.expected_revision!==null)throw new BetaHttpError('The current course selection changed. Review it again.',409);
 const id=randomUUID(),details={identity_key:review.identity_key,moodle_ids:review.moodle_ids,reviewed_at:review.reviewed_at,selection_source:review.selection_source,device_id:device};
 await c.query('INSERT INTO schoolvault.audit(user_id,id,action,target,details,created_at) VALUES($1,$2,$3,$4,$5,clock_timestamp())',[user,id,action,device,JSON.stringify(details)]);
 await checkHistory(c,user);
 return selector({id,details});
}
