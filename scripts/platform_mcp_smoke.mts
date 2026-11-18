// E4 smoke test: OAuth 2.1 + PKCE authorization by a synthetic learner, then the MCP SDK
// client calls every read-only tool on the web app's /mcp endpoint. Disposable local database only.
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {tenant,closeBetaPool} from '../lib/beta/db';
import {registerClient,approveAuthorization,exchangeToken,mcpResource} from '../lib/platform/oauth';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
const db=new URL(process.env.SCHOOL_BETA_DATABASE_URL||'');
if(db.hostname!=='127.0.0.1'||db.port!=='55471'||db.pathname!=='/neyvu_platform')throw Error('Disposable platform database only');
const mcp=new URL(mcpResource()!);
async function learner(label:string){const id=randomUUID();await tenant(id,async c=>{await c.query('INSERT INTO schoolvault.users(id,google_sub,email,name) VALUES($1,$2,$3,$4)',[id,id,`${label}-${id.slice(0,8)}@example.invalid`,label]);await c.query('INSERT INTO schoolvault.vaults(user_id) VALUES($1)',[id]);});return id;}
async function seed(user:string,text:string){const course=randomUUID(),source=randomUUID(),version=randomUUID(),passage=randomUUID();await tenant(user,async c=>{
 await c.query("INSERT INTO schoolvault.courses(user_id,id,code,title) VALUES($1,$2,'CHEM 1013','Synthetic chemistry')",[user,course]);
 await c.query("INSERT INTO schoolvault.sources(user_id,id,course_id,kind,title,current_version,original_url) VALUES($1,$2,$3,'note','Lab 4 handout',$4,'https://lms.example.invalid/lab4')",[user,source,course,version]);
 await c.query("INSERT INTO schoolvault.source_versions(user_id,id,source_id,body,sha256) VALUES($1,$2,$3,$4,$5)",[user,version,source,text,createHash('sha256').update(text).digest('hex')]);
 await c.query("INSERT INTO schoolvault.passages(user_id,id,source_id,version_id,ordinal,body) VALUES($1,$2,$3,$4,0,$5)",[user,passage,source,version,text]);
 await c.query("INSERT INTO schoolvault.tasks(user_id,id,course_id,source_id,external_id,evidence,observed_at) VALUES($1,$2,$3,$4,'lab4',$5,now())",[user,randomUUID(),course,source,JSON.stringify({title:'Lab 4 report',due_at:new Date(Date.now()+3*86400000).toISOString()})]);});return {course,passage};}
async function authorize(user:string){
 const client=await registerClient({client_name:'Smoke assistant',redirect_uris:['http://127.0.0.1:9999/callback']});
 const verifier=randomBytes(32).toString('base64url'),challenge=createHash('sha256').update(verifier).digest('base64url');
 const back=new URL(await approveAuthorization(user,{client_id:client.client_id,redirect_uri:'http://127.0.0.1:9999/callback',response_type:'code',code_challenge:challenge,code_challenge_method:'S256',state:'s1',resource:mcp.href,scope:'neyvu.read'}));
 assert.equal(back.searchParams.get('state'),'s1');const code=back.searchParams.get('code')!;
 const form=(v:string)=>new URLSearchParams({grant_type:'authorization_code',code,code_verifier:v,client_id:client.client_id,redirect_uri:'http://127.0.0.1:9999/callback',resource:mcp.href});
 await assert.rejects(exchangeToken(form(randomBytes(32).toString('base64url'))),/not valid/);   // wrong PKCE verifier
 const tokens=await exchangeToken(form(verifier));
 await assert.rejects(exchangeToken(form(verifier)),/not valid/);   // code replay -> also revokes tokens
 return {client,verifier,challenge,tokens:null as any,replayed:tokens};
}
async function freshTokens(user:string){
 const client=await registerClient({client_name:'Smoke assistant',redirect_uris:['http://127.0.0.1:9999/callback']});
 const verifier=randomBytes(32).toString('base64url'),challenge=createHash('sha256').update(verifier).digest('base64url');
 const code=new URL(await approveAuthorization(user,{client_id:client.client_id,redirect_uri:'http://127.0.0.1:9999/callback',response_type:'code',code_challenge:challenge,code_challenge_method:'S256',resource:mcp.href})).searchParams.get('code')!;
 return {...await exchangeToken(new URLSearchParams({grant_type:'authorization_code',code,code_verifier:verifier,client_id:client.client_id,redirect_uri:'http://127.0.0.1:9999/callback'})),client_id:client.client_id};
}
async function connect(token:string){const client=new Client({name:'neyvu-smoke',version:'0.0.1'});await client.connect(new StreamableHTTPClientTransport(mcp,{requestInit:{headers:{Authorization:'Bearer '+token}}}));return client;}
const text=(r:any)=>JSON.parse(r.content[0].text);

const a=await learner('smokeA'),b=await learner('smokeB');
const seededA=await seed(a,'Titration endpoint: add NaOH dropwise until the phenolphthalein turns faint pink.');
await seed(b,'Learner B private note about titration that A must never see.');
// Unauthenticated requests are challenged with Protected Resource Metadata.
const anon=await fetch(mcp,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:'{}'});
assert.equal(anon.status,401);assert.match(anon.headers.get('www-authenticate')||'',/resource_metadata=/);
const prm=await (await fetch(new URL('/.well-known/oauth-protected-resource'+mcp.pathname,mcp))).json();assert.equal(prm.resource,mcp.href.replace(/\/$/,''));
// PKCE and replay protection: the replayed code revokes the first token.
const first=await authorize(a);const replayedToken=first.replayed.access_token;
const revoked=await fetch(mcp,{method:'POST',headers:{authorization:'Bearer '+replayedToken,'content-type':'application/json',accept:'application/json, text/event-stream'},body:'{}'});assert.equal(revoked.status,401,'code replay revokes the first token');
const tokens=await freshTokens(a);
const client=await connect(tokens.access_token);
const tools=(await client.listTools()).tools;
assert.deepEqual(tools.map((t:any)=>t.name).sort(),['get_passage','list_courses','list_deadlines','search_my_sources','what_applies_to_me']);
assert.ok(tools.every((t:any)=>t.annotations?.readOnlyHint===true));
const courses=text(await client.callTool({name:'list_courses',arguments:{}}));assert.equal(courses.courses.length,1);
const deadlines=text(await client.callTool({name:'list_deadlines',arguments:{days:14}}));assert.equal(deadlines.deadlines[0].title,'Lab 4 report');assert.equal(deadlines.deadlines[0].submission,'unknown');
const found=text(await client.callTool({name:'search_my_sources',arguments:{query:'titration endpoint'}}));
assert.equal(found.results.length,1,'only learner A passages');assert.equal(found.results[0].passage_id,seededA.passage);
const passage=text(await client.callTool({name:'get_passage',arguments:{passage_id:seededA.passage}}));assert.match(passage.text,/phenolphthalein/);assert.equal(passage.citation.source_title,'Lab 4 handout');
const applies=text(await client.callTool({name:'what_applies_to_me',arguments:{question:'missed test'}}));assert.deepEqual(applies.organizations,[]);
// Learner B's token cannot read learner A's passage.
const clientB=await connect((await freshTokens(b)).access_token);
const crossed=await clientB.callTool({name:'get_passage',arguments:{passage_id:seededA.passage}});assert.equal(crossed.isError,true);
// Refresh rotates; the old refresh token then fails.
const rotated=await exchangeToken(new URLSearchParams({grant_type:'refresh_token',refresh_token:tokens.refresh_token,client_id:tokens.client_id}));
assert.ok(rotated.access_token&&rotated.access_token!==tokens.access_token);
await assert.rejects(exchangeToken(new URLSearchParams({grant_type:'refresh_token',refresh_token:tokens.refresh_token,client_id:tokens.client_id})),/not valid/);
// Refresh replay revokes the whole grant, including the rotated access token.
const afterReplay=await fetch(mcp,{method:'POST',headers:{authorization:'Bearer '+rotated.access_token,'content-type':'application/json',accept:'application/json, text/event-stream'},body:'{}'});assert.equal(afterReplay.status,401,'refresh replay revokes rotated token');
await client.close();await clientB.close();await closeBetaPool();
console.log(JSON.stringify({ok:true,tools:tools.map((t:any)=>t.name),deadline:deadlines.deadlines[0].title,passage_citation:passage.citation.source_title,cross_learner_blocked:true,pkce_and_replay_checked:true}));
