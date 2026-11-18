import type {PoolClient} from 'pg';
import {localAccountAvailable} from './config';

// The private owner imports a whole existing course vault. Public pilot
// allowances remain unchanged; a flag, foreign tenant or disabled account
// cannot opt into the larger local budget.
async function privateOwner(c:PoolClient,user:string){
 if(!localAccountAvailable()||user!==process.env.SCHOOL_LOCAL_USER_ID)return false;
 return (await c.query('SELECT schoolvault.local_owner_ready($1) AS ready',[user])).rows[0]?.ready===true;
}
export class HistoryLimit extends Error {constructor(){super('Invalid text: your vault history has reached its beta limit. Export saved work before adding more.');}}
// Originals share one budget, whether uploaded as a document or saved as audio.
export const storedObjects=`SELECT object_key,max(bytes) AS bytes FROM (
 SELECT object_key,bytes FROM schoolvault.source_versions WHERE user_id=$1 AND object_key IS NOT NULL
 UNION ALL SELECT object_key::text,bytes FROM schoolvault.class_audio_chunks WHERE user_id=$1
 ) objects GROUP BY object_key`;
// Lock the vault before admission so independent chats/imports share one writer budget.
export async function lockVault(c:Pick<PoolClient,'query'>,user:string){
 const row=(await c.query('SELECT user_id,text_quota_bytes FROM schoolvault.vaults WHERE user_id=$1 FOR UPDATE',[user])).rows[0];
 if(!row)throw Error('Vault not found');return row;
}
export async function checkHistory(c:PoolClient,user:string,extra=0){
 const vault=await lockVault(c,user);
 const used=Number((await c.query(`SELECT coalesce(sum(bytes),0) AS used FROM (
 SELECT sum(pg_column_size(v)) AS bytes FROM schoolvault.source_versions v WHERE user_id=$1
 UNION ALL SELECT sum(pg_column_size(p)) FROM schoolvault.passages p WHERE user_id=$1
 UNION ALL SELECT sum(pg_column_size(n)) FROM schoolvault.note_revisions n WHERE user_id=$1
 UNION ALL SELECT sum(pg_column_size(m)) FROM schoolvault.messages m WHERE user_id=$1
 UNION ALL SELECT sum(pg_column_size(j)) FROM schoolvault.jobs j WHERE user_id=$1
 UNION ALL SELECT sum(pg_column_size(ch)) FROM schoolvault.chats ch WHERE user_id=$1
 UNION ALL SELECT sum(pg_column_size(n)) FROM schoolvault.notes n WHERE user_id=$1
 UNION ALL SELECT sum(pg_column_size(t)) FROM schoolvault.tasks t WHERE user_id=$1
 UNION ALL SELECT sum(pg_column_size(m)) FROM schoolvault.meetings m WHERE user_id=$1
 UNION ALL SELECT sum(pg_column_size(s)) FROM schoolvault.sources s WHERE user_id=$1
 UNION ALL SELECT sum(pg_column_size(a)) FROM schoolvault.audit a WHERE user_id=$1
 UNION ALL SELECT sum(pg_column_size(d)) FROM schoolvault.companion_devices d WHERE user_id=$1
 UNION ALL SELECT sum(pg_column_size(sm)) FROM schoolvault.student_memory sm WHERE user_id=$1
 UNION ALL SELECT sum(pg_column_size(sp)) FROM schoolvault.source_profiles sp WHERE user_id=$1
 UNION ALL SELECT sum(pg_column_size(r)) FROM schoolvault.moodle_forum_evidence r WHERE user_id=$1
 UNION ALL SELECT sum(pg_column_size(r)) FROM schoolvault.moodle_forum_checks r WHERE user_id=$1
 UNION ALL SELECT sum(pg_column_size(r)) FROM schoolvault.moodle_receipts r WHERE user_id=$1
 UNION ALL SELECT sum(pg_column_size(r)) FROM schoolvault.moodle_receipt_checks r WHERE user_id=$1
 UNION ALL SELECT sum(pg_column_size(p)) FROM schoolvault.student_progress p WHERE user_id=$1
 UNION ALL SELECT sum(pg_column_size(p)) FROM schoolvault.student_plans p WHERE user_id=$1
 UNION ALL SELECT sum(pg_column_size(r)) FROM schoolvault.class_action_revisions r WHERE user_id=$1
 UNION ALL SELECT sum(pg_column_size(s)) FROM schoolvault.class_sessions s WHERE user_id=$1
 UNION ALL SELECT sum(pg_column_size(a)) FROM schoolvault.class_audio_chunks a WHERE user_id=$1
 UNION ALL SELECT sum(pg_column_size(t)) FROM schoolvault.class_transcripts t WHERE user_id=$1
 ) history`,[user])).rows[0].used);
 const ceiling=await privateOwner(c,user)?512*1024*1024:32*1024*1024;
 const limit=Math.min(ceiling,Number(vault.text_quota_bytes)||32*1024*1024);
 if(used+extra>limit)throw new HistoryLimit();
}
const limits={courses:40,chats:200,sources:2000,notes:1000,companion_devices:100,student_memory:100,student_plans:1000,class_sessions:200} as const;
export async function objectLimit(c:PoolClient,user:string,table:keyof typeof limits){
 return (table==='notes'||table==='sources')&&await privateOwner(c,user)?10_000:limits[table];
}
export async function questionLimits(c:PoolClient,user:string){
 return await privateOwner(c,user)?{daily:500,total:10_000}:{daily:100,total:1000};
}
export async function checkObjects(c:PoolClient,user:string,table:keyof typeof limits){
 await lockVault(c,user);
 const count=Number((await c.query(`SELECT count(*) FROM schoolvault.${table} WHERE user_id=$1`,[user])).rows[0].count);
 const limit=await objectLimit(c,user,table);
 if(count>=limit)throw Error(`Invalid text: your vault has reached its ${table} limit.`);
}
export async function admitCompanionDevice(c:PoolClient,user:string,{replacing=false}:{replacing?:boolean}={}){
 if(!replacing)await checkObjects(c,user,'companion_devices');
 await checkHistory(c,user,1500);
 const recent=Number((await c.query("SELECT (SELECT count(*) FROM schoolvault.companion_devices WHERE user_id=$1 AND created_at>now()-interval '1 hour')+(SELECT count(*) FROM schoolvault.audit WHERE user_id=$1 AND action='companion-reconnected' AND created_at>now()-interval '1 hour') AS count",[user])).rows[0].count);
 if(recent>=20)throw Error('Invalid text: too many laptop connections this hour. Existing laptops can still disconnect.');
}
