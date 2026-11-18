// Local candidate assembly only. The caller supplies an already verified
// official Electron runtime. No download, certificate or hosted build is used.
const fs=require('node:fs/promises'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {build,Platform,Arch}=require('electron-builder');
const {createHash}=require('node:crypto');
const {pathToFileURL}=require('node:url');
async function main(){
 const [arch,runtime,output,nativePackage]=process.argv.slice(2);
 if(process.platform!=='darwin'||!['arm64','x64'].includes(arch)||!runtime||!output||!path.isAbsolute(runtime)||!path.isAbsolute(output))throw Error('Use build-mac.cjs arm64|x64 ABSOLUTE_VERIFIED_RUNTIME ABSOLUTE_NEW_OUTPUT on a Mac.');
 const info=await fs.lstat(runtime);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Use a real verified runtime folder.');
 if((await fs.readFile(path.join(runtime,'version'),'utf8')).trim()!=='44.5.1')throw Error('Runtime version differs.');
 const executable=path.join(runtime,'Electron.app/Contents/MacOS/Electron');
 const actual=spawnSync('lipo',['-archs',executable],{encoding:'utf8'});if(actual.status!==0||actual.stdout.trim()!==(arch==='arm64'?'arm64':'x86_64'))throw Error('Runtime architecture differs.');
 await fs.mkdir(output);const stage=path.join(output,'source');await fs.mkdir(stage);
 const sources=['main.cjs','window-lifecycle.cjs','connection-storage.cjs','preload.cjs','engine.mjs','collection-navigation.mjs','course-membership.mjs','handoff.mjs','capture.mjs','collection-plan.mjs','collection-memory.mjs','attachment-read.mjs','content-packet.mjs','content-upload.mjs','content-journal.mjs','content-collector.mjs','native-pdf-reader.mjs','native-package.mjs','original-recovery.mjs','preflight.mjs','protocol.mjs','package.json','package-lock.json','ui/index.html','ui/style.css','ui/app.js'];
 const hashes={};for(const name of sources){const src=path.join(__dirname,name),st=await fs.lstat(src);if(!st.isFile()||st.isSymbolicLink())throw Error('Unsafe source: '+name);const dest=path.join(stage,name);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.copyFile(src,dest);hashes[name]=createHash('sha256').update(await fs.readFile(src)).digest('hex');}
 const version=JSON.parse(await fs.readFile(path.join(stage,'package.json'),'utf8')).version;
 if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Use a numbered Companion release version.');
 hashes['icon.icns']=createHash('sha256').update(await fs.readFile(path.join(__dirname,'icon.icns'))).digest('hex');
 await fs.writeFile(path.join(stage,'integrity.json'),'{}');
 await fs.mkdir(path.join(stage,'node_modules'));
 await fs.cp(path.join(__dirname,'node_modules/playwright-core'),path.join(stage,'node_modules/playwright-core'),{recursive:true,dereference:false});
 let native=null,extraResources=[];
 if(nativePackage){
  if(!path.isAbsolute(nativePackage))throw Error('Use an absolute verified native-reader package folder.');
  const stat=await fs.lstat(nativePackage);if(!stat.isDirectory()||stat.isSymbolicLink()||(await fs.readdir(nativePackage)).sort().join('|')!=='native-reader.json|neyvu-pdf-reader')throw Error('Use a complete native-reader package with no extra files.');
  for(const n of ['native-reader.json','neyvu-pdf-reader']){const st=await fs.lstat(path.join(nativePackage,n));if(!st.isFile()||st.isSymbolicLink())throw Error('Unsafe native-reader package file.');}
  const {validateNativePackage}=await import(pathToFileURL(path.join(__dirname,'native-package.mjs')));native=validateNativePackage(JSON.parse(await fs.readFile(path.join(nativePackage,'native-reader.json'),'utf8')),{architecture:arch});
  if(native.source_sha256!==createHash('sha256').update(await fs.readFile(path.join(__dirname,'native-pdf.swift'))).digest('hex')||native.binary_sha256!==createHash('sha256').update(await fs.readFile(path.join(nativePackage,native.file))).digest('hex'))throw Error('The native reader does not match this source and binary.');
  const binaryArch=spawnSync('/usr/bin/lipo',['-archs',path.join(nativePackage,native.file)],{encoding:'utf8'});if(binaryArch.status!==0||binaryArch.stdout.trim()!==(arch==='arm64'?'arm64':'x86_64'))throw Error('Native reader architecture differs.');
  const pin=await fs.readFile(path.join(nativePackage,'native-reader.json'));await fs.writeFile(path.join(stage,'native-reader.json'),pin);hashes['native-reader.json']=createHash('sha256').update(pin).digest('hex');
  const resource=path.join(output,'native-resource');await fs.mkdir(resource);await fs.copyFile(path.join(nativePackage,native.file),path.join(resource,native.file));await fs.chmod(path.join(resource,native.file),0o755);extraResources=[{from:resource,to:'native-pdf'}];
 }
 const files=await build({projectDir:stage,targets:Platform.MAC.createTarget('dir',arch==='arm64'?Arch.arm64:Arch.x64),publish:'never',config:{electronVersion:'44.5.1',electronDist:runtime,npmRebuild:false,nodeGypRebuild:false,afterPack:path.join(__dirname,'package-integrity.cjs'),extraResources,directories:{output:path.join(output,'delivery')},mac:{target:['dir'],identity:null,icon:path.join(__dirname,'icon.icns'),category:'public.app-category.education',minimumSystemVersion:'13.0'}}});
 const app=path.join(output,'delivery',arch==='arm64'?'mac-arm64':'mac','Neyvu Companion.app');
 if(!(await fs.lstat(app)).isDirectory())throw Error('Expected Mac app was not assembled.');
 // Ad-hoc signing permits local integrity/launch checks. It is not an Apple
 // publisher identity or notarization, and is never described as either.
 // Finder metadata copied into an iCloud-hosted build is not valid signed
 // bundle content. Remove only these two metadata attributes from this newly
 // generated bundle; never remove quarantine or change the retained runtime.
 for(const attribute of ['com.apple.FinderInfo','com.apple.ResourceFork'])spawnSync('/usr/bin/xattr',['-dr',attribute,app],{encoding:'utf8'});
 const sign=spawnSync('codesign',['--force','--deep','--sign','-',app],{encoding:'utf8'});if(sign.status!==0){await fs.writeFile(path.join(output,'signing-error.log'),sign.stderr||sign.stdout||'');throw Error('Local ad-hoc signing failed; diagnostic retained.');}
 const verify=spawnSync('codesign',['--verify','--deep','--strict',app],{encoding:'utf8'});if(verify.status!==0)throw Error('Local code signature integrity failed.');
 if(native){const asar=await import('@electron/asar'),check=path.join(output,'native-payload-readback');asar.extractAll(path.join(app,'Contents/Resources/app.asar'),check);const {loadPackagedNativeReader}=await import(pathToFileURL(path.join(__dirname,'native-package.mjs')));const loaded=await loadPackagedNativeReader({appRoot:check,resourcesRoot:path.join(app,'Contents/Resources'),architecture:arch});if(!loaded||loaded.manifest.binary_sha256!==native.binary_sha256)throw Error('Signed application native-reader readback differs.');}
 const receipt={native_reader:native,native_reader_packaged:!!native,architecture:arch,app,version,source_hashes:hashes,after_pack_sha256:createHash('sha256').update(await fs.readFile(path.join(__dirname,'package-integrity.cjs'))).digest('hex'),electron_runtime:runtime,local_signature:'ad-hoc',publisher_verified:false,notarized:false,public_distribution_qualified:false,physical_device_tested:false,hosted_build:false,new_purchase:false,artifacts:files};
 await fs.writeFile(path.join(output,'assembly-receipt.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({assembled:true,architecture:arch,app,local_signature:'ad-hoc',public_distribution_qualified:false}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
