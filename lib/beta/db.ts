import {Pool,type PoolClient} from 'pg';
let pool:Pool|undefined;
export const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function betaPool(){
 if(!process.env.SCHOOL_BETA_DATABASE_URL)throw Error('SchoolVault storage is not configured');
 return pool??=new Pool({connectionString:process.env.SCHOOL_BETA_DATABASE_URL,max:5,connectionTimeoutMillis:5000,idleTimeoutMillis:10000,statement_timeout:15000,application_name:'schoolvault-beta'});
}
export async function tenant<T>(userId:string,fn:(client:PoolClient)=>Promise<T>,options:{readOnlySnapshot?:boolean}={}){
 if(!uuid(userId))throw Error('Invalid account');
 const c=await betaPool().connect();
 try{
  await c.query(options.readOnlySnapshot?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN');
  await c.query("SELECT set_config('schoolvault.user_id',$1,true)",[userId]);
  const identity=(await c.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
  if(identity.rolsuper||identity.rolbypassrls)throw Error('SchoolVault runtime requires a restricted database role');
  const result=await fn(c);await c.query('COMMIT');return result;
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
export async function closeBetaPool(){await pool?.end();pool=undefined;}
