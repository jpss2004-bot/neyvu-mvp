import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Client} from 'pg';
// Explicit administrator operation. Never invoked by the web process or a build.
if(!process.env.SCHOOL_BETA_MIGRATION_URL)throw Error('Set a separate School migration connection');
const client=new Client({connectionString:process.env.SCHOOL_BETA_MIGRATION_URL});
await client.connect();
try{
 await client.query("SELECT pg_advisory_lock(hashtext('schoolvault-migrations'))");
 await client.query('CREATE SCHEMA IF NOT EXISTS schoolvault');
 await client.query('CREATE TABLE IF NOT EXISTS schoolvault.schema_migrations(version integer PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
 const folder=new URL('../deploy/migrations/',import.meta.url);
 for(const name of (await readdir(folder)).filter(n=>/^\d{3}_[a-z_]+\.sql$/.test(n)).sort()){
  const version=Number(name.slice(0,3)),sql=await readFile(new URL(name,folder),'utf8'),sha=createHash('sha256').update(sql).digest('hex');
  const old=(await client.query('SELECT sha256 FROM schoolvault.schema_migrations WHERE version=$1',[version])).rows[0];
  if(old&&old.sha256!==sha)throw Error('Applied migration differs from source. Add a new migration; do not overwrite it.');
  if(!old){
   await client.query('BEGIN');
   await client.query(sql.replace(/^BEGIN;\s*/,'').replace(/COMMIT;\s*$/,''));
   await client.query('INSERT INTO schoolvault.schema_migrations(version,sha256) VALUES($1,$2)',[version,sha]);
   await client.query('COMMIT');
  }
  console.log(JSON.stringify({migration:version,applied:!old,sha256:sha}));
 }
}catch(error){await client.query('ROLLBACK');throw error;}
finally{await client.query("SELECT pg_advisory_unlock(hashtext('schoolvault-migrations'))");await client.end();}
