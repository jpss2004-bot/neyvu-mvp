// Local Store submission assembly over the retained, verified Windows runtime.
// No Windows build, download, certificate, publication or protection change.
const fs=require('node:fs/promises'),path=require('node:path');
const {createHash}=require('node:crypto'),{spawnSync}=require('node:child_process');
const BASE_MANIFEST='29473a7ed80805b40eedbba9e7f3457c3bf7ba015ca41576ebe4eaf55203babc';
const BASE_APPX='f34ceb2b9e4bfa90e1d4a8ca375407ba53380c7962daeb23f8a7c521e4910910';
const SDK_SHA='98144a6eddc1fdc0f8903e6d2b6997426a9c4392200f95763e107e774bca2b37';
const SDK_LIBRARY_SHA='dfd28090d8f4fb0bee7451f780099b061a0006a43ffe501ce50e2834c3cc1f2e';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hash=async file=>sha(await fs.readFile(file));
const xml=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
async function files(root,prefix=''){
 const result=[];
 for(const entry of await fs.readdir(path.join(root,prefix),{withFileTypes:true})){
  const rel=prefix+entry.name;if(entry.isSymbolicLink())throw Error('Unexpected package link: '+rel);
  if(entry.isDirectory())result.push(...await files(root,rel+'/'));
  else if(entry.isFile())result.push(rel);else throw Error('Unexpected package entry: '+rel);
 }return result.sort();
}
async function main(){
 const [base,out,sdk]=process.argv.slice(2);
 if(!base||!out||!sdk||![base,out,sdk].every(path.isAbsolute))throw Error('Supply ABSOLUTE_VERIFIED_BASE ABSOLUTE_NEW_OUTPUT ABSOLUTE_VALIDATING_MAKEMSIX.');
 const sdkLibrary=path.resolve(path.dirname(sdk),'../lib');
 if(await hash(sdk)!==SDK_SHA||await hash(path.join(sdkLibrary,'libmsix.dylib'))!==SDK_LIBRARY_SHA)throw Error('The validating Microsoft SDK differs.');
 const sdkOptions={encoding:'utf8',maxBuffer:8*1024*1024,env:{...process.env,DYLD_LIBRARY_PATH:sdkLibrary}};
 const appxBase=(await fs.stat(base)).isFile();let runtimeRoot,baseEvidence;
 if(appxBase){
  if(await hash(base)!==BASE_APPX)throw Error('The retained Windows Store package differs.');
  await fs.mkdir(out);const recovered=path.join(out,'verified-base');
  const result=spawnSync(sdk,['unpack','-p',base,'-d',recovered,'-ss'],sdkOptions);
  await fs.writeFile(path.join(out,'base-unpack.log'),(result.stdout||'')+(result.stderr||''));
  if(result.status!==0)throw Error('Verified base unpack failed; diagnostic retained.');
  runtimeRoot=path.join(recovered,'app');baseEvidence={base_appx_sha256:BASE_APPX};
  const manifest=await fs.readFile(path.join(recovered,'AppxManifest.xml'),'utf8');
  const id=JSON.parse(await fs.readFile(path.join(__dirname,'store-identity.json'),'utf8'));
  if(!manifest.includes('Name="'+id.identityName+'"')||!manifest.includes('Publisher="'+id.publisher+'"')||!manifest.includes('Id="SchoolVaultCompanion"'))throw Error('Existing Store identity differs.');
 }else{
  const manifestFile=path.join(base,'SHA256-MANIFEST.json');
  if(await hash(manifestFile)!==BASE_MANIFEST)throw Error('The retained, approved Windows base manifest differs.');
  const manifest=JSON.parse(await fs.readFile(manifestFile,'utf8'));
  for(const file of manifest.files){
   if(!file.path||path.isAbsolute(file.path)||file.path.split(/[\\/]/).includes('..'))throw Error('Unsafe base entry.');
   const p=path.join(base,file.path);if(!(await fs.lstat(p)).isFile()||await hash(p)!==file.sha256)throw Error('Base bytes differ: '+file.path);
  }
  await fs.mkdir(out);runtimeRoot=path.join(base,'SchoolVault Companion');baseEvidence={base_manifest_sha256:BASE_MANIFEST};
 }
 const packageRoot=path.join(out,'package'),app=path.join(packageRoot,'app'),stage=path.join(out,'asar-source');
 await fs.mkdir(packageRoot);await fs.cp(runtimeRoot,app,{recursive:true,dereference:false});
 const asar=await import('@electron/asar');const archive=path.join(app,'resources/app.asar');asar.extractAll(archive,stage);
 const baseDependencyHashes={};for(const rel of await files(path.join(stage,'node_modules')))baseDependencyHashes[rel]=await hash(path.join(stage,'node_modules',rel));
 const names=['main.cjs','window-lifecycle.cjs','connection-storage.cjs','preload.cjs','engine.mjs','collection-navigation.mjs','course-membership.mjs','handoff.mjs','capture.mjs','collection-plan.mjs','collection-memory.mjs','attachment-read.mjs','content-packet.mjs','content-upload.mjs','content-journal.mjs','content-collector.mjs','native-pdf-reader.mjs','native-package.mjs','original-recovery.mjs','preflight.mjs','protocol.mjs','package.json','ui/index.html','ui/style.css','ui/app.js'];
 const sourceHashes={};for(const name of names){await fs.copyFile(path.join(__dirname,name),path.join(stage,name));sourceHashes[name]=await hash(path.join(__dirname,name));}
 await asar.createPackage(stage,archive);asar.uncache(archive);
 const exe=path.join(app,'Neyvu Companion.exe');if(!appxBase)await fs.rename(path.join(app,'SchoolVault Companion.exe'),exe);
 const {NtExecutable,NtExecutableResource,Resource,Data}=await import('resedit');
 const executable=NtExecutable.from(await fs.readFile(exe)),resource=NtExecutableResource.from(executable);
 const versions=Resource.VersionInfo.fromEntries(resource.entries);if(versions.length!==1)throw Error('Expected one Windows version resource.');
 const version=versions[0];version.setFileVersion('0.3.0.0');version.setProductVersion('0.3.0.0');
 for(const language of version.getAllLanguagesForStringValues())version.setStringValues(language,{CompanyName:'Neyvu',FileDescription:'Neyvu Companion',InternalName:'Neyvu Companion',OriginalFilename:'Neyvu Companion.exe',ProductName:'Neyvu Companion'});
 version.outputToResourceEntries(resource.entries);
 const icons=Data.IconFile.from(await fs.readFile(path.join(__dirname,'icon.ico'))).icons.map(i=>i.data);
 const groups=Resource.IconGroupEntry.fromEntries(resource.entries);if(!groups.length)throw Error('Windows icon resource missing.');
 for(const group of groups)Resource.IconGroupEntry.replaceIconsForResource(resource.entries,group.id,group.lang,icons);
 resource.outputResource(executable);await fs.writeFile(exe,Buffer.from(executable.generate()));
 await require('./package-integrity.cjs')({appOutDir:app,electronPlatformName:'win32',packager:{appInfo:{version:'0.3.0',productFilename:'Neyvu Companion'}}});
 const verify=path.join(out,'asar-readback');asar.uncache(archive);asar.extractAll(archive,verify);
 const {verifyDelivery}=await import('./preflight.mjs');const integrity=await verifyDelivery(app,verify);
 for(const [rel,digest] of Object.entries(baseDependencyHashes))if(await hash(path.join(verify,'node_modules',rel))!==digest)throw Error('Frozen dependency changed: '+rel);
 if((await files(path.join(verify,'node_modules'))).length!==Object.keys(baseDependencyHashes).length)throw Error('Frozen dependency inventory differs.');
 for(const [name,digest] of Object.entries(sourceHashes))if(await hash(path.join(verify,name))!==digest)throw Error('Current source readback differs: '+name);
 let unchangedRuntime=0;
 for(const rel of await files(runtimeRoot)){
  if(['SchoolVault Companion.exe','Neyvu Companion.exe','resources/app.asar'].includes(rel))continue;
  if(await hash(path.join(runtimeRoot,rel))!==await hash(path.join(app,rel)))throw Error('Frozen native runtime changed: '+rel);unchangedRuntime++;
 }
 const id=JSON.parse(await fs.readFile(path.join(__dirname,'store-identity.json'),'utf8'));
 const config=require('./store-config.cjs')({SCHOOL_STORE_IDENTITY_NAME:id.identityName,SCHOOL_STORE_PUBLISHER:id.publisher,SCHOOL_STORE_PUBLISHER_DISPLAY_NAME:id.publisherDisplayName});
 const assets=path.join(packageRoot,'assets');await fs.cp(path.join(__dirname,'build/appx'),assets,{recursive:true});
 const text=`<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10" xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10" xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities" IgnorableNamespaces="uap rescap">
 <Identity Name="${xml(id.identityName)}" Publisher="${xml(id.publisher)}" Version="0.3.13.0" ProcessorArchitecture="x64" />
 <Properties><DisplayName>Neyvu Companion</DisplayName><PublisherDisplayName>${xml(id.publisherDisplayName)}</PublisherDisplayName><Logo>assets\\StoreLogo.png</Logo></Properties>
 <Dependencies><TargetDeviceFamily Name="Windows.Desktop" MinVersion="${config.appx.minVersion}" MaxVersionTested="${config.appx.maxVersionTested}" /></Dependencies>
 <Resources><Resource Language="en-US" /></Resources>
 <Applications><Application Id="SchoolVaultCompanion" Executable="app\\Neyvu Companion.exe" EntryPoint="Windows.FullTrustApplication"><uap:VisualElements DisplayName="Neyvu Companion" Description="Connect your Acadia Moodle courses to Neyvu." BackgroundColor="#263b31" Square150x150Logo="assets\\Square150x150Logo.png" Square44x44Logo="assets\\Square44x44Logo.png"><uap:DefaultTile Wide310x150Logo="assets\\Wide310x150Logo.png" /></uap:VisualElements></Application></Applications>
 <Capabilities><Capability Name="internetClient" /><rescap:Capability Name="runFullTrust" /></Capabilities>
</Package>\n`;
 await fs.writeFile(path.join(packageRoot,'AppxManifest.xml'),text);
 const artifact=path.join(out,'Neyvu-0.3.13.0-x64.appx'),unpack=path.join(out,'validated-unpack');
 for(const [name,args] of [['pack',['pack','-d',packageRoot,'-p',artifact]],['unpack',['unpack','-p',artifact,'-d',unpack,'-ss']]]){
  const result=spawnSync(sdk,args,sdkOptions);await fs.writeFile(path.join(out,name+'.log'),(result.stdout||'')+(result.stderr||''));if(result.status!==0)throw Error('Validating SDK '+name+' failed; original log retained.');
 }
 const payload=await files(packageRoot);for(const rel of payload)if(await hash(path.join(packageRoot,rel))!==await hash(path.join(unpack,rel)))throw Error('AppX roundtrip differs: '+rel);
 const receipt={created_at:new Date().toISOString(),package:artifact,bytes:(await fs.stat(artifact)).size,sha256:await hash(artifact),store_version:'0.3.13.0',source_version:JSON.parse(await fs.readFile(path.join(stage,'package.json'),'utf8')).version,...baseEvidence,source_hashes:sourceHashes,unchanged_native_runtime_files:unchangedRuntime,frozen_dependency_files:Object.keys(baseDependencyHashes).length,embedded_integrity:integrity,sdk_sha256:await hash(sdk),sdk_library_sha256:SDK_LIBRARY_SHA,schema_validated:true,roundtrip_files:payload.length,identity_name:id.identityName,application_id:'SchoolVaultCompanion',store_product:id.productId,signature:'unsigned Store submission candidate',certified:false,protected_windows_tested:false,physical_moodle_tested:false,hosted_build:false,new_purchase:false};
 await fs.writeFile(path.join(out,'verification.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({assembled:true,package:artifact,sha256:receipt.sha256,roundtrip_files:payload.length,public_distribution_qualified:false}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
