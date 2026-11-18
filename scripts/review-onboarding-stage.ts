// Local visual-review fixture only. Uses real pairing, selection and capture storage.
import {readFileSync,writeFileSync} from 'node:fs';
import {tenant,closeBetaPool} from '../lib/beta/db';
import {createCompanionPairing,redeemCompanionPairing,companionActor,importMoodleCapture} from '../lib/beta/companion';
import {saveCurrentCourseSelection} from '../lib/beta/course-selection';
async function main(){
 const db=new URL(process.env.SCHOOL_BETA_DATABASE_URL||'');if(db.hostname!=='127.0.0.1'||db.port!=='55432'||db.pathname!=='/schoolvault_profiles_20261107t230000z')throw Error('Named disposable review database only');
 const user='88888888-8888-4888-8888-888888888888',file='../Local app/motion-device.private.json',stage=process.argv[2];
 if(stage==='connect'){const device=await redeemCompanionPairing((await createCompanionPairing(user)).code);writeFileSync(file,JSON.stringify(device),{mode:0o600});}
 else{
  const device=JSON.parse(readFileSync(file,'utf8')),identity='moodle-user:200 · Fictional motion review';
  if(stage==='reading')await tenant(user,async c=>{await saveCurrentCourseSelection(c,user,device.device_id,{identity,identity_key:'200',moodle_ids:['54321'],reviewed_at:new Date().toISOString(),selection_source:'user-reviewed'});await c.query("INSERT INTO schoolvault.courses(user_id,code,title,moodle_id) VALUES($1,'TEST 54321','Fictional review course','54321') ON CONFLICT DO NOTHING",[user]);});
  else if(stage==='readable')await importMoodleCapture(await companionActor(device.token),{course:{id:'54321',title:'Fictional review course',url:'https://moodle.acadiau.ca/course/view.php?id=54321'},identity,title:'Argument analysis instructions',url:'https://moodle.acadiau.ca/mod/page/view.php?id=54321',body:'State the author’s conclusion, identify two supporting premises, and explain one possible objection. Begin with a short outline before writing your response. This is fictional material for testing.',captured_at:new Date().toISOString(),coverage:{scope:'visible-activity',issues:[]}});
  else throw Error('Unknown review stage');
 }
 console.log('Local fixture stage:',stage);
}
main().finally(closeBetaPool);
