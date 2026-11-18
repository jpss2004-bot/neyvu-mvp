import {randomUUID} from 'node:crypto';
import {tenant} from './db';
import {BetaHttpError} from './http';
import {requireAdmin} from './admissions';
import {parsePilotReport} from './pilot-report-format';
import {release} from './release';
import {lockVault} from './budget';
export async function savePilotReport(actor:{id:string;email:string;demo?:boolean},body:Record<string,unknown>){
 if(actor.demo)throw new BetaHttpError('Reports are available in your own student account.',403);
 let report:ReturnType<typeof parsePilotReport>;
 try{report=parsePilotReport(body);}catch(error){throw new BetaHttpError((error as Error).message);}
 return tenant(actor.id,async c=>{
  await lockVault(c,actor.id);
  if(!(await c.query('SELECT id FROM schoolvault.users WHERE id=$1 AND disabled_at IS NULL',[actor.id])).rowCount)throw new BetaHttpError('Please sign in to share a report.',401);
  await c.query("SELECT pg_advisory_xact_lock(hashtext('pilot-reports:'||$1))",[actor.id]);
  const previous=(await c.query('SELECT stage,outcome,device,elapsed,description FROM schoolvault.pilot_reports WHERE user_id=$1 AND id=$2',[actor.id,report.id])).rows[0];
  if(previous){if(Object.keys(previous).some(k=>previous[k]!==report[k]))throw new BetaHttpError('This report was already shared. Open a new report for another issue.',409);return {id:report.id,shared:true};}
  if(Number((await c.query("SELECT count(*) FROM schoolvault.pilot_reports WHERE created_at>now()-interval '1 day'")).rows[0].count)>=20)throw new BetaHttpError('You have shared 20 reports today. Please try again tomorrow.',429);
  await c.query('INSERT INTO schoolvault.pilot_reports(user_id,id,email,stage,outcome,device,elapsed,description,release) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[actor.id,report.id,actor.email,report.stage,report.outcome,report.device,report.elapsed,report.description,release.version+' / schema '+release.schema+(/^[a-f0-9]{40}$/.test(process.env.RENDER_GIT_COMMIT||'')?' / '+process.env.RENDER_GIT_COMMIT!.slice(0,7):'')]);
  return {id:report.id,shared:true};
 });
}
export async function reviewPilotReports(){
 await requireAdmin();
 return tenant(randomUUID(),async c=>{
  await c.query("SELECT set_config('schoolvault.report_admin','verified',true)");
  return (await c.query('SELECT id,email,stage,outcome,device,elapsed,description,release,created_at FROM schoolvault.pilot_reports ORDER BY created_at DESC LIMIT 100')).rows;
 });
}
