// Workstream C app-side smoke check against a disposable local database.
// Every network call goes to synthetic mocks; no real account, site or token.
// Run (dev cluster only):
//   SCHOOL_BETA_DATABASE_URL=postgres://neyvu_runtime:dev@127.0.0.1:55436/neyvu_connectors \
//   NEYVU_SMOKE_ADMIN_URL=postgres://postgres@127.0.0.1:55436/neyvu_connectors \
//   SCHOOL_BETA_FILE_ROOT=/abs/scratch/files npx tsx scripts/connectors-smoke.mts
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Client} from 'pg';

const db=new URL(process.env.SCHOOL_BETA_DATABASE_URL||'');
if(db.hostname!=='127.0.0.1'||db.pathname!=='/neyvu_connectors')throw Error('Disposable local neyvu_connectors database required');
Object.assign(process.env,{NEYVU_CONNECTIONS_PAGE:'1',NEYVU_CONNECTOR_MOODLE_TOKEN:'1',NEYVU_CONNECTOR_GMAIL:'1',NEYVU_CONNECTOR_OUTLOOK:'1',NEYVU_INSTITUTION_EVIDENCE:'1',NEYVU_PDF_PAGE_CITATIONS:'1',
 NEYVU_CONNECTOR_TOKEN_KEY:randomBytes(32).toString('base64'),NEYVU_GOOGLE_MAIL_CLIENT_ID:'fixture-client',NEYVU_GOOGLE_MAIL_CLIENT_SECRET:'fixture-secret',SCHOOL_BETA_ORIGIN:'http://localhost:3213'});

const {tenant,closeBetaPool}=await import('../lib/beta/db');
const acc=await import('../lib/beta/connectors/accounts');
const {syncAccount}=await import('../lib/beta/connectors/sync');
const {institutionEvidenceFor}=await import('../lib/beta/connectors/institution-evidence');
const {pdfPageForExcerpt}=await import('../lib/beta/connectors/citation-page');
const {loadMoodleFixture,moodleMockFetch,moodleSsoCallbackFor}=await import('../packages/connectors/src/mocks/moodle-mock');
const {gmailMockFetch,tokenEndpointMock,COURSE_SENDER}=await import('../packages/connectors/src/mocks/mail-mock');

const moodle=loadMoodleFixture(fileURLToPath(new URL('../packages/connectors/fixtures/moodle-ws/site.json',import.meta.url)));
const moodleFetch=moodleMockFetch(moodle),gmailFetch=gmailMockFetch();
let tokenFetch:typeof fetch=async()=>{throw Error('no token mock');};
acc.connectorNetwork.fetch=(async(input:any,init?:any)=>{
 const url=String(input instanceof Request?input.url:input);
 if(url.startsWith(moodle.site))return moodleFetch(input,init);
 if(url.startsWith('https://gmail.googleapis.com'))return gmailFetch(input,init);
 if(url.startsWith('https://oauth2.googleapis.com'))return tokenFetch(input,init);
 throw Error('smoke: unexpected network call '+url);
}) as typeof fetch;

const admin=new Client({connectionString:process.env.NEYVU_SMOKE_ADMIN_URL});await admin.connect();
async function user(institution:string|null){
 const id=randomUUID();
 await admin.query('INSERT INTO schoolvault.users(id,google_sub,email,name,institution_id) VALUES($1,$2,$3,$4,$5)',[id,'smoke:'+id,id+'@test.invalid','Synthetic Learner',institution]);
 await admin.query('INSERT INTO schoolvault.vaults(user_id) VALUES($1)',[id]);
 return id;
}
const checks:string[]=[];const ok=(name:string)=>{checks.push(name);console.log('ok -',name);};
try{
 const a=await user('acadia'),b=await user(null),dal=await user('dalhousie');

 // Moodle token connector: site URL -> SSO launch -> callback -> sync.
 const start:any=await acc.startConnection(a,{kind:'moodle_token',site_url:'moodle.example.edu'});
 assert.equal(start.method,'sso');
 const passport=new URL(start.launch_url).searchParams.get('passport')!;
 const moodleAcct=await acc.connectMoodleWithSso(a,{state:start.state,callback:moodleSsoCallbackFor(moodle,passport)});
 const stored=(await admin.query('SELECT token_box,external_identity FROM schoolvault.connector_accounts WHERE id=$1',[moodleAcct.id])).rows[0];
 assert.ok(stored.token_box.startsWith('v1.')&&!stored.token_box.includes(moodle.token));
 ok('Moodle SSO connect stores only a sealed token');
 const first=await syncAccount(a,moodleAcct.id);
 assert.equal(first.status,'complete',JSON.stringify(first));
 assert.ok(first.counts.courses===2&&first.counts.tasks===1&&first.counts.files_saved===1&&first.counts.events===1&&first.counts.groups===1,JSON.stringify(first.counts));
 const kinds=(await admin.query('SELECT kind,count(*)::int n FROM schoolvault.sources WHERE user_id=$1 GROUP BY kind ORDER BY kind',[a])).rows;
 assert.deepEqual(kinds.map(k=>k.kind),['file','moodle']);
 ok(`Moodle sync wrote courses, sources, tasks, file, calendar and groups ${JSON.stringify(first.counts)}`);
 const second=await syncAccount(a,moodleAcct.id);
 assert.ok(second.counts.sources_new===0&&second.counts.sources_updated===0&&second.counts.files_saved===0,JSON.stringify(second.counts));
 ok('Re-sync with unchanged content adds no versions');

 // Gmail: OAuth code flow -> confirmed sender -> only course mail kept.
 const g:any=await acc.startConnection(a,{kind:'gmail'});
 const auth=new URL(g.authorize_url);
 assert.equal(auth.origin,'https://accounts.google.com');
 tokenFetch=tokenEndpointMock({code:'fixture-code',clientId:'fixture-client',clientSecret:'fixture-secret'});
 const gmailAcct=await acc.finishOAuth(a,auth.searchParams.get('state'),'fixture-code');
 const course=(await admin.query("SELECT id FROM schoolvault.courses WHERE user_id=$1 AND code='DEMO 1020'",[a])).rows[0].id;
 await acc.confirmSender(a,gmailAcct.id,{address:COURSE_SENDER,course_id:course});
 const mail=await syncAccount(a,gmailAcct.id);
 assert.ok(mail.counts.mail_kept===2&&mail.counts.mail_discarded===1,JSON.stringify(mail.counts));
 const emails=(await admin.query("SELECT v.body FROM schoolvault.sources s JOIN schoolvault.source_versions v ON v.id=s.current_version AND v.user_id=s.user_id WHERE s.user_id=$1 AND s.kind='email'",[a])).rows;
 assert.ok(emails.length===2&&emails.every(e=>/From: .*prof\.sample@example\.edu/.test(e.body)&&/Open in your mailbox: https:\/\//.test(e.body)));
 assert.ok(!(await admin.query("SELECT 1 FROM schoolvault.source_versions WHERE body LIKE '%newsletter%'")).rowCount);
 ok(`Gmail kept confirmed course mail with sender/date/link, discarded the rest ${JSON.stringify(mail.counts)}`);

 // Tenant isolation: learner B sees none of A's connector rows.
 const seen=await tenant(b,async c=>(await c.query('SELECT count(*)::int n FROM schoolvault.connector_accounts')).rows[0].n+(await c.query('SELECT count(*)::int n FROM schoolvault.connector_items')).rows[0].n);
 assert.equal(seen,0);
 assert.equal((await acc.listAccounts(b)).length,0);
 await assert.rejects(syncAccount(b,moodleAcct.id));
 ok('Cross-tenant: another learner cannot list or sync these connections');

 // Disconnect wipes the sealed token.
 await acc.disconnectAccount(a,gmailAcct.id);
 const gone=(await admin.query('SELECT token_box,status,revoked_at FROM schoolvault.connector_accounts WHERE id=$1',[gmailAcct.id])).rows[0];
 assert.ok(gone.token_box===null&&gone.status==='revoked'&&gone.revoked_at);
 assert.equal((await admin.query('SELECT count(*)::int n FROM schoolvault.connector_mail_senders WHERE account_id=$1',[gmailAcct.id])).rows[0].n,0);
 ok('Disconnect wipes the token and the confirmed senders');

 // Institution evidence: labelled, only for the learner's own institution.
 const evidence=await tenant(a,c=>institutionEvidenceFor(c,'acadia','missed test declaration of cause'));
 assert.ok(evidence.length>0&&evidence.every(e=>e.label==='institution source'&&e.visibility==='public_institution'&&e.open_url.startsWith('/api/beta/institution-sources?version=')));
 assert.equal((await tenant(b,c=>institutionEvidenceFor(c,null,'missed test declaration of cause'))).length,0);
 assert.equal((await tenant(dal,c=>institutionEvidenceFor(c,'dalhousie','missed test declaration of cause'))).length,0);
 const cols=(await admin.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='institution_public' AND column_name ~ '(user|email|learner|chat|course)'")).rows[0].n;
 assert.equal(cols,0);
 ok(`Institution evidence labelled for Acadia (${evidence.length}: ${evidence.slice(0,2).map(e=>e.title+(e.page?' p.'+e.page:'')).join('; ')}); none for no-school or Dalhousie (not loaded)`);

 // C9 page helper on extract_pdf.py-shaped text.
 assert.equal(pdfPageForExcerpt('Page 1\nIntro text here.\n\nPage 2\nThe declaration of cause form is due within five days.\n\n','declaration of cause form is due within five days'),2);
 ok('Cited excerpt maps to its PDF page');
 console.log(JSON.stringify({smoke:'pass',checks:checks.length}));
}finally{await admin.end();await closeBetaPool();}
