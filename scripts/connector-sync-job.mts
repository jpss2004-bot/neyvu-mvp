// Scheduled connector sync (operator job). Syncs every connected account of every
// active learner through the restricted runtime role, one tenant at a time.
// Run: SCHOOL_BETA_DATABASE_URL=... NEYVU_CONNECTOR_TOKEN_KEY=... npx tsx scripts/connector-sync-job.mts
import {betaPool,tenant,closeBetaPool} from '../lib/beta/db';
import {syncAllAccounts} from '../lib/beta/connectors/sync';
import {connectionsPageEnabled} from '../lib/beta/connectors/flags';
if(!connectionsPageEnabled()){console.log(JSON.stringify({skipped:'NEYVU_CONNECTIONS_PAGE is off'}));process.exit(0);}
try{
 const results=await syncAllAccounts(
  async()=>(await betaPool().query('SELECT id FROM schoolvault.users WHERE disabled_at IS NULL ORDER BY id')).rows.map(r=>r.id),
  user=>tenant(user,async c=>(await c.query('SELECT id FROM schoolvault.connector_accounts WHERE user_id=$1 AND revoked_at IS NULL AND status<>$2',[user,'needs_reauth'])).rows.map(r=>r.id)),
 );
 console.log(JSON.stringify({synced:results.length,failed:results.filter(r=>r.status==='failed').length}));
}finally{await closeBetaPool();}
