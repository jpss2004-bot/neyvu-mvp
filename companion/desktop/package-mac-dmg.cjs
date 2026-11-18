// Offline disk-image assembly from a verified local build. This does not sign
// with a publisher identity, notarize, download, or publish an app.
const fs=require('node:fs/promises'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {createHash}=require('node:crypto');
async function main(){
 const [candidate]=process.argv.slice(2);
 if(process.platform!=='darwin'||!candidate||!path.isAbsolute(candidate))throw Error('Use package-mac-dmg.cjs ABSOLUTE_LOCAL_BUILD on a Mac.');
 const receipt=JSON.parse(await fs.readFile(path.join(candidate,'assembly-receipt.json'),'utf8'));
 if(!['arm64','x64'].includes(receipt.architecture)||!receipt.app.startsWith(candidate+path.sep))throw Error('Unexpected build receipt.');
 const version=JSON.parse(await fs.readFile(path.join(__dirname,'package.json'),'utf8')).version;
 if(!/^\d+\.\d+\.\d+$/.test(version)||receipt.version!==version)throw Error('Rebuild with the current Companion release version.');
 for(const [name,hash] of Object.entries(receipt.source_hashes)){
  const source=name==='native-reader.json'?path.join(candidate,'source',name):path.join(__dirname,name);
  if(createHash('sha256').update(await fs.readFile(source)).digest('hex')!==hash)throw Error('Rebuild before packaging: '+name);
 }
 function run(command,args){const result=spawnSync(command,args,{encoding:'utf8'});if(result.status!==0)throw Error(command+' failed: '+result.stderr);return result.stdout;}
 run('codesign',['--verify','--deep','--strict',receipt.app]);
 const folder=path.join(candidate,'disk-image');await fs.mkdir(folder);
 run('ditto',[receipt.app,path.join(folder,'Neyvu Companion.app')]);
 await fs.symlink('/Applications',path.join(folder,'Applications'));
 const chip=receipt.architecture==='arm64'?'Apple Silicon':'Intel';
 await fs.writeFile(path.join(folder,'Start here.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Start Neyvu on your Mac</title><style>body{font:18px/1.65 system-ui;background:#080b11;color:#f5f5f7;max-width:660px;margin:8vh auto;padding:24px}h1{line-height:1.15}h2{margin-top:2em}li{margin:14px 0}a{color:#a8c7ff}aside{border:1px solid #52617d;padding:18px;border-radius:18px}</style><body><p>Neyvu Companion · ${chip} · macOS 13 or later</p><h1>Your courses. Your own vault.</h1><aside><strong>One extra step the first time.</strong> Neyvu isn't registered with Apple yet, so the first time you open it macOS will say it couldn't verify the app. That's expected for this pilot build. Only continue if you got this file straight from the link Neyvu sent you. Never turn off your Mac's security settings or paste Terminal commands to get past it.</aside><h2>Before you start</h2><ul><li>Install <strong>Google Chrome</strong> or <strong>Microsoft Edge</strong>. The Companion opens Moodle in one of them.</li><li>Use the Google account Neyvu approved for you.</li></ul><h2>Install</h2><ol><li>Drag <strong>Neyvu Companion</strong> into <strong>Applications</strong>, then eject this disk.</li><li>Open <strong>Neyvu Companion</strong> from Applications. macOS shows a message that it couldn't verify the app. Choose <strong>Done</strong>. Don't choose Move to Trash.</li><li><strong>macOS 15 or later:</strong> open <strong>System Settings → Privacy &amp; Security</strong>, scroll down to <strong>Security</strong>, and next to “Neyvu Companion was blocked” choose <strong>Open Anyway</strong>. Enter your Mac password, then choose <strong>Open Anyway</strong> again.<br><strong>macOS 13 or 14:</strong> in Applications, hold Control and click <strong>Neyvu Companion</strong>, choose <strong>Open</strong>, then <strong>Open</strong> again.</li><li>That's it. After this first time it opens normally.</li></ol><h2>Connect</h2><ol><li>The Companion checks its files and the Neyvu connection first.</li><li>Choose <strong>Connect Neyvu account</strong> and pick your approved Google account in the browser, then come back to the Companion.</li><li>Choose <strong>Open Moodle</strong> and sign in to Acadia Moodle yourself. Then choose <strong>Check Moodle account</strong> and <strong>Choose current courses</strong>. Keep the app open while it collects their pages and files.</li><li>Read the collection report. Missing or restricted pages need attention before you rely on a plan. Then open Neyvu and ask about your material.</li></ol><p>Keep the Companion open when you want it to collect updates. Closing it stops collection; your saved notes and sources stay in Neyvu.</p><p><a href="https://neyvu-app.example.com/beta/start">Open the first-session guide</a></p></body></html>`);
 const dmg=path.join(candidate,`Neyvu-Companion-${version}-Mac-${receipt.architecture==='arm64'?'Apple-Silicon':'Intel'}.dmg`);
 run('hdiutil',['create','-volname',`Neyvu ${chip}`,'-srcfolder',folder,'-format','UDZO',dmg]);
 run('hdiutil',['verify',dmg]);
 const output={version,architecture:receipt.architecture,dmg,sha256:createHash('sha256').update(await fs.readFile(dmg)).digest('hex'),bytes:(await fs.stat(dmg)).size,publisher_verified:false,notarized:false,public_distribution_qualified:false,new_purchase:false,hosted_build:false};
 await fs.writeFile(path.join(candidate,'disk-image-receipt.json'),JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
