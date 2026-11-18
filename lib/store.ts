import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

export const ACCOUNT = 'personal-acadia';
export const dataDirectory = () => process.env.SCHOOL_PILOT_DATA || path.join(os.homedir(), 'Library/Application Support/School Pilot');
let connection: DatabaseSync | undefined;
export function db() {
  if (connection) return connection;
  mkdirSync(dataDirectory(), { recursive: true, mode: 0o700 });
  const file = path.join(dataDirectory(), 'pilot.sqlite');
  connection = new DatabaseSync(file);
  chmodSync(file, 0o600);
  connection.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY, account TEXT NOT NULL, course TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', transcript TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '', origin TEXT NOT NULL DEFAULT 'app', source_url TEXT, external_id TEXT, notion_id TEXT, notion_hash TEXT, synced_body TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS note_external ON notes(account,external_id) WHERE external_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS revisions(id TEXT PRIMARY KEY, account TEXT NOT NULL, note_id TEXT NOT NULL, version INTEGER, body TEXT, created_at TEXT, reason TEXT);
    CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY, account TEXT NOT NULL, note_id TEXT NOT NULL, name TEXT, mime TEXT, file_path TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, account TEXT NOT NULL, note_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, result TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, account TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, sources TEXT, mode TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings(account TEXT NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY(account,key));
    CREATE TABLE IF NOT EXISTS pairs(code_hash TEXT PRIMARY KEY, account TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, account TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY, account TEXT NOT NULL, action TEXT, target TEXT, created_at TEXT NOT NULL);
  `);
  if(!connection.prepare('PRAGMA table_info(revisions)').all().some(r=>r.name==='snapshot'))connection.exec('ALTER TABLE revisions ADD COLUMN snapshot TEXT');
  if(!connection.prepare('PRAGMA table_info(jobs)').all().some(r=>r.name==='worker_pid'))connection.exec('ALTER TABLE jobs ADD COLUMN worker_pid INTEGER');
  connection.exec(`CREATE TABLE IF NOT EXISTS chat_threads(id TEXT PRIMARY KEY,account TEXT NOT NULL,title TEXT NOT NULL,course TEXT NOT NULL DEFAULT '',intent TEXT NOT NULL DEFAULT 'ask',context TEXT NOT NULL DEFAULT '[]',draft TEXT NOT NULL DEFAULT '',archived INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS chat_turns(id TEXT PRIMARY KEY,account TEXT NOT NULL,thread_id TEXT NOT NULL,request_id TEXT NOT NULL,question TEXT NOT NULL,course TEXT NOT NULL,intent TEXT NOT NULL,context TEXT NOT NULL,status TEXT NOT NULL,error TEXT NOT NULL DEFAULT '',worker_pid INTEGER,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS thread_account ON chat_threads(account,updated_at);
  `);
  if(!connection.prepare('PRAGMA table_info(messages)').all().some(r=>r.name==='thread_id'))connection.exec('ALTER TABLE messages ADD COLUMN thread_id TEXT');
  connection.exec('CREATE INDEX IF NOT EXISTS message_thread ON messages(account,thread_id,created_at)');
  connection.exec('BEGIN IMMEDIATE');
  try{
    for(const row of connection.prepare('SELECT DISTINCT account FROM messages WHERE thread_id IS NULL').all()){
      const account=String(row.account),id='legacy:'+account,now=new Date().toISOString();
      connection.prepare("INSERT OR IGNORE INTO chat_threads(id,account,title,created_at,updated_at) VALUES(?,?,'Earlier conversations',?,?)").run(id,account,now,now);
      connection.prepare('UPDATE messages SET thread_id=? WHERE account=? AND thread_id IS NULL').run(id,account);
    }
    connection.exec('COMMIT');
  }catch(error){connection.exec('ROLLBACK');throw error;}
  connection.prepare("UPDATE chat_turns SET status='interrupted',error='The host restarted before the answer finished. Retry this question.',updated_at=? WHERE status='running' AND (worker_pid IS NULL OR worker_pid!=?)").run(new Date().toISOString(),process.pid);
  // Different route bundles can open separate connections in the same process.
  // Only a job owned by an earlier process is interrupted on restart.
  recoverInterruptedJobs(connection);
  return connection;
}
export function recoverInterruptedJobs(database:DatabaseSync,ownerPid=process.pid){database.prepare("UPDATE jobs SET status='interrupted', error='Processing interrupted. You can retry.', updated_at=? WHERE status='running' AND (worker_pid IS NULL OR worker_pid!=?)").run(new Date().toISOString(),ownerPid);}
export type Note = { id:string; account:string; course:string; title:string; body:string; transcript:string; summary:string; origin:string; source_url:string|null; external_id:string|null; notion_id:string|null; notion_hash:string|null; synced_body:string|null; version:number; created_at:string; updated_at:string; attachments?:Attachment[] };
export type Attachment={id:string;note_id:string;name:string;mime:string;kind:string;created_at:string};
export class Conflict extends Error { constructor(message='This note changed elsewhere. Your draft is preserved; reload before saving again.') { super(message); } }
// All API bundles reserve native host capacity through the same SQLite writer.
export function reserveProcessingJob(noteId:string,kind:string,account=ACCOUNT){
 if(!['summary','transcribe'].includes(kind))throw Error('Unknown processing task');
 const database=db(),id=randomUUID(),now=new Date().toISOString();database.exec('BEGIN IMMEDIATE');
 try{
  if(!database.prepare('SELECT id FROM notes WHERE id=? AND account=?').get(noteId,account))throw Error('Note not found');
  if(database.prepare("SELECT id FROM jobs WHERE note_id=? AND account=? AND status='running'").get(noteId,account))throw new Conflict('This note is already processing.');
  if(Number(database.prepare("SELECT count(*) AS n FROM jobs WHERE status='running'").get()?.n)>=2)throw new Conflict('Two recordings or summaries are processing. Let one finish, then try again.');
  database.prepare('INSERT INTO jobs(id,account,note_id,kind,status,result,error,created_at,updated_at,worker_pid) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,account,noteId,kind,'running',null,null,now,now,process.pid);
  database.exec('COMMIT');return id;
 }catch(error){database.exec('ROLLBACK');throw error;}
}
export function note(id:string, account=ACCOUNT) { return db().prepare('SELECT * FROM notes WHERE id=? AND account=?').get(id,account) as unknown as Note|undefined; }
export function notes(account=ACCOUNT) { return db().prepare('SELECT * FROM notes WHERE account=? ORDER BY updated_at DESC').all(account) as unknown as Note[]; }
export function createNote(course:string,title:string,body='',account=ACCOUNT) {
  const id=randomUUID(), now=new Date().toISOString();
  db().prepare('INSERT INTO notes(id,account,course,title,body,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,account,course,title,body,now,now);
  audit('note-created',id,account); return note(id,account)!;
}
export function updateNote(id:string,version:number,changes:Partial<Pick<Note,'title'|'body'|'transcript'|'summary'|'notion_id'|'notion_hash'|'synced_body'|'source_url'>>,account=ACCOUNT) {
  const current=note(id,account); if(!current) throw new Error('Note not found');
  if(current.version!==version) throw new Conflict();
  const allowed=['title','body','transcript','summary','notion_id','notion_hash','synced_body','source_url'];
  const fields=Object.entries(changes).filter(([k])=>allowed.includes(k));
  if(!fields.length)return current;
  const database=db(); database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare('INSERT INTO revisions(id,account,note_id,version,body,created_at,reason,snapshot) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),account,id,version,current.body,new Date().toISOString(),'before-edit',JSON.stringify(current));
    const result=database.prepare(`UPDATE notes SET ${fields.map(([k])=>k+'=?').join(',')},version=version+1,updated_at=? WHERE id=? AND account=? AND version=?`).run(...fields.map(([,v])=>v??null),new Date().toISOString(),id,account,version);
    if(!result.changes)throw new Conflict();
    database.exec('COMMIT'); return note(id,account)!;
  }catch(error){database.exec('ROLLBACK');throw error;}
}
export function attachments(id:string,account=ACCOUNT){return db().prepare('SELECT id,note_id,name,mime,kind,created_at FROM attachments WHERE note_id=? AND account=?').all(id,account).map(row=>({...row})) as Attachment[];}
export function audit(action:string,target:string,account=ACCOUNT){db().prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run(randomUUID(),account,action,target,new Date().toISOString());}
export function setting(key:string,value?:string,account=ACCOUNT) {
  if(value!==undefined)db().prepare('INSERT INTO settings VALUES(?,?,?) ON CONFLICT(account,key) DO UPDATE SET value=excluded.value').run(account,key,value);
  return (db().prepare('SELECT value FROM settings WHERE account=? AND key=?').get(account,key) as {value:string}|undefined)?.value;
}
