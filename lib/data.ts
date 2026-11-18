import 'server-only';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
export type Task = {id:string; source_id:string; title:string; course:string; official_url:string; preparation:boolean; due:string|null; due_authority:string; planned_due?:string|null; source_observed_at?:string|null; do_on:string|null; label:string; submission:string; receipt_checked:string|null; receipt_fresh:boolean; grade:string; grade_checked:string|null; grade_fresh:boolean; needs_attention:boolean; conflict:boolean; next_action:string; working_status:string; confirmed_submitted:boolean};
export type SchoolData = {
  generatedAt:string; heartbeat:string|null; tasks:Task[];
  focus:{id:string; title:string; course:string; action:string; why:string; done_when:string; due:string|null; url:string}[];
  health:{id:string; name:string; status:string; last_complete_observation:string|null; last_observation:string|null; scope:string}[];
  delivery:{id:string; kind:string; status:string; provider:string; accepted_at:string|null; attempts:number}[];
  operations:{name:string; status:string; last_success_at:string|null; checked_at:string|null}[];
  vault:{built_at:string|null; documents:number|null; chunks:number|null; edges:number|null};
};
export async function readSchool(): Promise<SchoolData> {
  if (process.env.VERCEL || (process.env.NODE_ENV !== 'development' && process.env.SCHOOL_PILOT_LOCAL !== '1')) throw new Error('Local school adapter unavailable');
  const { SCHOOL_PYTHON, SCHOOL_OPERATIONS_PATH, SCHOOL_SNAPSHOT_PATH } = process.env;
  if (!SCHOOL_PYTHON || !SCHOOL_OPERATIONS_PATH || !SCHOOL_SNAPSHOT_PATH) throw new Error('School adapter not configured');
  const {stdout} = await promisify(execFile)(SCHOOL_PYTHON, [path.join(process.cwd(), 'scripts/read_school.py'), SCHOOL_OPERATIONS_PATH, SCHOOL_SNAPSHOT_PATH], {timeout:15000, maxBuffer:2_000_000});
  const data:SchoolData = JSON.parse(stdout);
  if (!Array.isArray(data.tasks) || !Array.isArray(data.health)) throw new Error('Invalid school snapshot');
  return data;
}
