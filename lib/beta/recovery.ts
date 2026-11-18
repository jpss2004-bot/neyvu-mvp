// Operator-only primitives. No public route imports this module.
import type {PoolClient} from 'pg';import {uuid} from './db';import {lockVault,storedObjects} from './budget';
export const contentTables=['vaults','courses','sources','source_versions','citation_preferences','citation_metadata','passages','passage_embeddings','edges','notes','note_revisions','tasks','meetings','chats','student_memory','source_profiles','student_progress','student_plans','messages','jobs','answer_traces','connectors','audit','pilot_reports','companion_devices','moodle_receipts','moodle_receipt_checks','moodle_forum_evidence','moodle_forum_checks','moodle_observations','class_sessions','class_audio_chunks','class_transcripts','class_action_revisions','connector_accounts','connector_items','connector_mail_senders','connector_sync_runs','kg_entities','kg_edges','kg_evidence','learner_profile_facts','class_capture_consents'] as const;
export const removalTables=['kg_evidence','kg_edges','kg_entities','connector_items','connector_mail_senders','connector_sync_runs','connector_accounts','connector_handshakes','oauth_codes','oauth_tokens','oauth_grants','org_memberships','learner_profile_facts','class_capture_consents','citation_metadata','citation_preferences','pilot_reports','sessions','companion_tokens','companion_pairings','moodle_forum_checks','moodle_forum_evidence','moodle_receipt_checks','moodle_observations','answer_traces','jobs','messages','student_memory','student_progress','class_action_revisions','student_plans','source_profiles','chats','note_revisions','moodle_receipts','companion_devices','class_transcripts','class_audio_chunks','class_sessions','notes','edges','passage_embeddings','passages','tasks','meetings','source_versions','sources','connectors','audit','courses','vaults'] as const;
// Sign-in and access records: removed with the account, never restored from a snapshot.
const authenticationTables=['sessions','companion_tokens','companion_pairings','connector_handshakes','oauth_grants','oauth_codes','oauth_tokens','org_memberships'] as const;
// These shared records are outside tenant-content removal. Report the actual limits;
// retaining them is not a claim of complete identity erasure or backup deletion.
export const globalRecoveryRetention={
 users:'Disabled identity tombstone is retained to prevent automatic vault recreation.',
 login_attempts:'Short-lived identity replay metadata is excluded from content restore/removal.',
 access_requests:'Admission contact details and decisions remain for separate operator review.',
 access_request_notifications:'Admission notification records remain with the access request.',
 admission_audit:'Admission decision history remains for separate operator review.',
 access_limits:'Shared abuse counters remain; they are not a tenant-content table.',
 admin_logins:'Separate administrator login records are not student content.',
 admin_sessions:'Separate administrator sessions are not student content.',
 worker_status:'Shared worker health metadata is retained.',
 demo_attempts:'Shared reviewer-demo admission metadata is retained.',
 storage_budget:'The shared counter is adjusted for removed originals, not deleted.',
 schema_migrations:'The shared migration ledger is retained.',
 organizations:'Institution records are shared by their members, not one learner\'s content.',
 org_invitations:'Invitations keep the invited email until accepted, revoked or expired; erasure requests are handled by operator review.',
 org_journeys:'Institution onboarding journeys are shared institution content; the author id remains as a reference.',
 org_public_sources:'Institution public sources are shared institution content; the author and reviewer ids remain as references.',
 org_usage_daily:'Aggregate institution usage counts hold no learner content.',
 org_usage_seen:'De-duplication markers for aggregate usage counts are shared institution metadata.',
 oauth_clients:'Registered assistant applications are shared; per-learner grants and tokens are removed with the account.',
 capture_takedown_requests:'Recording takedown requests from instructors or classmates are kept for operator review.',
} as const;
export async function lockRecoveryAccount(c:Pick<PoolClient,'query'>,user:string){
 if(!uuid(user))throw Error('Invalid account');
 await c.query("SELECT pg_advisory_xact_lock(hashtextextended('schoolvault-account-lifecycle:'||lower($1),0))",[user]);
}
export async function assertRecoveryCoverage(c:Pick<PoolClient,'query'>){
 // information_schema hides tables without grants; the catalog must catch those too.
 const rows=(await c.query("SELECT t.relname AS name,EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=t.oid AND a.attname='user_id' AND a.attnum>0 AND NOT a.attisdropped) AS tenant FROM pg_catalog.pg_class t JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='schoolvault' AND t.relkind IN('r','p') ORDER BY t.relname")).rows;
 const tables=rows.filter(row=>row.tenant).map(row=>row.name as string),globals=rows.filter(row=>!row.tenant).map(row=>row.name as string);
 const actual=new Set(tables),removal=new Set<string>(removalTables),snapshot=new Set<string>(contentTables),authentication=new Set<string>(authenticationTables);
 const missingRemoval=tables.filter(table=>!removal.has(table)),missingSnapshot=tables.filter(table=>!snapshot.has(table)&&!authentication.has(table));
 const absent=[...new Set([...removal,...snapshot])].filter(table=>!actual.has(table));
 const unclassifiedGlobal=globals.filter(table=>!Object.hasOwn(globalRecoveryRetention,table)),absentGlobal=Object.keys(globalRecoveryRetention).filter(table=>!globals.includes(table));
 if(missingRemoval.length||missingSnapshot.length||absent.length||unclassifiedGlobal.length||absentGlobal.length)throw Error('Recovery coverage does not match the schema: '+JSON.stringify({missingRemoval,missingSnapshot,absent,unclassifiedGlobal,absentGlobal}));
 return {tables,snapshotAuthenticationExclusions:[...authentication],globalRetention:globalRecoveryRetention};
}
export async function snapshotTenant(c:Pick<PoolClient,'query'>,user:string){
 await lockRecoveryAccount(c,user);
 await assertRecoveryCoverage(c);
 await lockVault(c,user);const tables:Record<string,unknown[]>={};
 for(const table of contentTables)tables[table]=(await c.query(`SELECT * FROM schoolvault.${table} WHERE user_id=$1`,[user])).rows;
 // Authentication sessions and bearer-token hashes are intentionally excluded.
 return {version:1,user_id:user,tables};
}
export async function restoreTenant(c:Pick<PoolClient,'query'>,user:string,backup:Awaited<ReturnType<typeof snapshotTenant>>){
 if(!uuid(user)||backup.version!==1)throw Error('Invalid restore');
 await lockRecoveryAccount(c,user);
 await assertRecoveryCoverage(c);
 if(!(await c.query('SELECT 1 FROM schoolvault.users WHERE id=$1 AND disabled_at IS NOT NULL',[user])).rowCount)throw Error('Restore account must be disabled');
 if((await c.query('SELECT 1 FROM schoolvault.vaults WHERE user_id=$1',[user])).rowCount)throw Error('Restore target must be empty');
 const originals=new Map<string,number>();for(const v of backup.tables.source_versions||[]){const row=v as any;if(row.object_key)originals.set(row.object_key,Math.max(originals.get(row.object_key)||0,Number(row.bytes)));}
 for(const v of backup.tables.class_audio_chunks||[]){const row=v as any;originals.set(row.object_key,Math.max(originals.get(row.object_key)||0,Number(row.bytes)));}
 const bytes=[...originals.values()].reduce((a,b)=>a+b,0);if(!(await c.query('UPDATE schoolvault.storage_budget SET used_bytes=used_bytes+$1 WHERE id=true AND used_bytes+$1<=limit_bytes RETURNING id',[bytes])).rowCount)throw Error('Restore exceeds file budget');
 await c.query('SET CONSTRAINTS ALL DEFERRED');
 // Sources point at versions via a deferred FK. Other tables follow dependency order.
 for(const table of contentTables){for(const row of backup.tables[table]||[]){
  const record={...row as any,user_id:user};if(table==='class_sessions'&&record.actions_state==null)record.actions_state='waiting';
  await c.query(`INSERT INTO schoolvault.${table} SELECT (json_populate_record(NULL::schoolvault.${table},$1::json)).*`,[JSON.stringify(record)]);
 }}
}
export async function deletionPlan(c:Pick<PoolClient,'query'>,user:string){
 if(!uuid(user))throw Error('Invalid account');await lockRecoveryAccount(c,user);await assertRecoveryCoverage(c);await lockVault(c,user);
 const originals=(await c.query(storedObjects,[user])).rows;
 const files=originals.map(r=>r.object_key as string),bytes=originals.reduce((n,r)=>n+Number(r.bytes),0);
 const counts:Record<string,number>={};for(const table of removalTables)counts[table]=Number((await c.query(`SELECT count(*) FROM schoolvault.${table} WHERE user_id=$1`,[user])).rows[0].count);
 return {user_id:user,files,bytes,counts};
}
export async function removeTenantRecords(c:Pick<PoolClient,'query'>,user:string,confirmedId:string){
 if(confirmedId!==user)throw Error('Exact account confirmation required');
 const plan=await deletionPlan(c,user);await c.query('SET CONSTRAINTS ALL DEFERRED');
 if(!(await c.query('SELECT pg_current_xact_id_if_assigned() AS transaction')).rows[0].transaction)throw Error('An explicit operator transaction is required');
 if(!(await c.query('UPDATE schoolvault.storage_budget SET used_bytes=used_bytes-$1 WHERE id=true AND used_bytes>=$1 RETURNING id',[plan.bytes])).rowCount)throw Error('Storage accounting needs operator review; deletion was refused');
 await c.query('UPDATE schoolvault.users SET disabled_at=now() WHERE id=$1',[user]);
 for(const table of removalTables)await c.query(`DELETE FROM schoolvault.${table} WHERE user_id=$1`,[user]);
 // Keep a disabled identity tombstone so Google sign-in cannot silently recreate this vault.
 return plan;
}
