import {chromium} from 'playwright-core';
import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {protect} from './credentials.mjs';
import {createInterface} from 'node:readline/promises';
import {MOODLE,readURL,pageDOM,accountIdentity,makeCapture} from './capture.mjs';
const ORIGIN='https://neyvu-app.example.com';
if(process.platform!=='win32'||!process.env.LOCALAPPDATA)throw Error('This companion is for Windows.');
const root=join(process.env.LOCALAPPDATA,'SchoolVault Companion'),stateFile=join(root,'connection.dpapi'),lockFile=join(root,'running.lock');
await mkdir(root,{recursive:true});
async function save(state){const temporary=stateFile+'.tmp';await writeFile(temporary,await protect(JSON.stringify(state)));await rename(temporary,stateFile);}
async function request(path,body,secret){
 const r=await fetch(ORIGIN+path,{method:'POST',headers:{'Content-Type':'application/json',...(secret?{Authorization:'Bearer '+secret}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(30000),redirect:'error'});
 const data=await r.json();if(!r.ok){const error=Error(data.error||'SchoolVault could not receive this update.');error.status=r.status;throw error;}return data;
}
const terminal=createInterface({input:process.stdin,output:process.stdout});let context,locked=false;
try{
 // A crashed process is checked before a stale lock is replaced; active instances never compete.
 try{const pid=Number(await readFile(lockFile,'utf8'));if(Number.isSafeInteger(pid)&&pid>0){try{process.kill(pid,0);throw Error('SchoolVault Companion is already running.');}catch(e){if(e.code!=='ESRCH')throw e;}}await unlink(lockFile);}catch(e){if(e.code!=='ENOENT')throw e;}
 await writeFile(lockFile,String(process.pid),{flag:'wx'});locked=true;
 let state;try{state=JSON.parse(await protect(await readFile(stateFile,'utf8'),true));}catch(e){if(e.code!=='ENOENT')throw Error('The saved connection could not be opened. Use the Disconnect shortcut to reset it.');}
 console.log('\nSchoolVault Companion\nMoodle passwords and cookies stay on this Windows account.\nClose this window to pause updates. The phone app will show the last check.\n');
 if(!state){
  console.log('Open '+ORIGIN+'/beta, sign in with Google, and choose Connect Moodle.');
  const code=(await terminal.question('Paste the one-time connection code here: ')).trim();
  state=await request('/api/beta/companion?op=redeem',{code});await save(state);
 }
 context=await chromium.launchPersistentContext(join(root,'moodle-browser'),{channel:'msedge',headless:false,acceptDownloads:false});
 if(state.cookies)await context.addCookies(state.cookies);
 const page=context.pages()[0]||await context.newPage();await page.goto(MOODLE+'/my/courses.php',{waitUntil:'domcontentloaded'});
 console.log('Sign in to Acadia Moodle in the separate Edge window. Open your user menu so your profile link is available.');
 await terminal.question('When your course list is visible, press Enter: ');
 let expected=state.identity||accountIdentity(await page.evaluate(pageDOM));
 if(!state.identity){console.log('Moodle account: '+expected);const answer=(await terminal.question('Connect this Moodle account to the Google account you paired? Type YES: ')).trim();if(answer!=='YES')throw Error('Connection cancelled.');state.identity=expected;await save(state);}
 async function collect(){
  await page.goto(MOODLE+'/my/courses.php',{waitUntil:'domcontentloaded'});
  await page.locator('#region-main').waitFor({timeout:20000});
  const listing=await page.evaluate(pageDOM);if(accountIdentity(listing)!==expected)throw Error('Moodle sign-in changed or expired. Sign in again and reopen the companion.');
  const courses=new Map();for(const link of listing.links){const url=readURL(link.url,true);if(url&&link.title.trim()){const id=new URL(url).searchParams.get('id');courses.set(id,{id,url,title:link.title.trim().slice(0,180)});}}
  if(!courses.size)throw Error('No courses were visible. Check Moodle and reopen the companion.');
  if(courses.size>40)throw Error('The course list exceeds this beta limit.');
  let pages=0,issues=0;
  for(const course of courses.values()){
   await page.goto(course.url,{waitUntil:'domcontentloaded'});await page.locator('#region-main').waitFor({timeout:20000});
   const dom=await page.evaluate(pageDOM);await request('/api/beta/companion',makeCapture(dom,course,expected),state.token);pages++;
   const urls=[...new Set(dom.links.map(l=>readURL(l.url)).filter(u=>u&&u!==course.url))];
   for(const url of urls.slice(0,100)){
    if(new URL(url).pathname==='/course/view.php')continue;
    try{await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});await page.locator('#region-main').waitFor({timeout:10000});await request('/api/beta/companion',makeCapture(await page.evaluate(pageDOM),course,expected),state.token);pages++;}catch(e){if(e.status===401||e.status===409)throw e;issues++;}
   }
   if(urls.length>100)issues++;
  }
  state.cookies=await context.cookies(MOODLE);await save(state);
  console.log(new Date().toLocaleTimeString()+': '+pages+' visible pages refreshed'+(issues?' · '+issues+' pages need another check.':'.'));
 }
 await collect();console.log('Updates run every 20 minutes while this window is open. Ctrl+C stops the companion.');
 while(true){await new Promise(resolve=>setTimeout(resolve,20*60*1000));try{await collect();}catch(e){if(e.status===401||e.status===409)throw e;console.log('Refresh paused: '+e.message+' Next check in 20 minutes.');}}
}catch(e){console.error('\n'+e.message+'\nNo Moodle submissions or messages were sent.');process.exitCode=1;}
finally{terminal.close();await context?.close();if(locked)await unlink(lockFile).catch(()=>{});}
