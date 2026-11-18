// Runs after Electron packaging, before signing/installer creation. Inventory the
// actual ASAR contents, not development node_modules or a frozen runtime layout.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createHash}=require('node:crypto');
module.exports=async context=>{
 const asar=await import('@electron/asar');
 const mac=context.electronPlatformName==='darwin';
 const contents=mac?path.join(context.appOutDir,context.packager.appInfo.productFilename+'.app','Contents'):null;
 const archive=mac?path.join(contents,'Resources','app.asar'):path.join(context.appOutDir,'resources','app.asar');
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'schoolvault-integrity-'));
 try{
  asar.extractAll(archive,temporary);
  const sources=[],dependencies=[];
  async function scan(folder,prefix=''){
   for(const entry of await fs.readdir(folder,{withFileTypes:true})){
    const rel=prefix+entry.name,p=path.join(folder,entry.name);
    if(entry.isSymbolicLink())throw Error('Package links are unsupported');
    if(entry.isDirectory())await scan(p,rel+'/');
    else if(rel!=='integrity.json'){
     const record={path:rel,sha256:createHash('sha256').update(await fs.readFile(p)).digest('hex')};
     (rel.startsWith('node_modules/')?dependencies:sources).push(record);
    }
   }
  }
  await scan(temporary);
  await fs.writeFile(path.join(temporary,'integrity.json'),JSON.stringify({format:2,delivery:'installer',version:context.packager.appInfo.version,runtime:[],sources,dependencies}));
  await asar.createPackage(temporary,archive);asar.uncache(archive);
  // electron-builder embeds the ASAR header hash before afterPack. Refresh that
  // resource after changing the archive, while the executable is still unsigned.
  if(context.electronPlatformName==='win32'){
   const {NtExecutable,NtExecutableResource}=await import('resedit');
   const executablePath=path.join(context.appOutDir,context.packager.appInfo.productFilename+'.exe');
   const executable=NtExecutable.from(await fs.readFile(executablePath));
   const resource=NtExecutableResource.from(executable);
   const entries=resource.entries.filter(e=>e.type==='INTEGRITY'&&e.id==='ELECTRONASAR');
   if(entries.length!==1)throw Error('Expected one embedded ASAR integrity resource');
   const records=JSON.parse(Buffer.from(entries[0].bin).toString());
   const appRecord=records.find(r=>r.file==='resources\\app.asar');
   if(!appRecord)throw Error('Embedded app ASAR record missing');
   appRecord.alg='SHA256';appRecord.value=createHash('sha256').update(asar.getRawHeader(archive).headerString).digest('hex');
   entries[0].bin=Buffer.from(JSON.stringify(records));resource.outputResource(executable);
   await fs.writeFile(executablePath,Buffer.from(executable.generate()));
  }
  if(mac){
   const plist=require('plist'),file=path.join(contents,'Info.plist');
   const info=plist.parse(await fs.readFile(file,'utf8'));
   const record=info.ElectronAsarIntegrity?.['Resources/app.asar'];
   if(!record)throw Error('Embedded Mac ASAR record missing');
   record.algorithm='SHA256';record.hash=createHash('sha256').update(asar.getRawHeader(archive).headerString).digest('hex');
   await fs.writeFile(file,plist.build(info));
  }
 }finally{await fs.rm(temporary,{recursive:true,force:true});}
};
