// Compile only with the already installed Apple SDK. No dependency download,
// hosted build, certificate purchase or distribution authorization.
const fs=require('node:fs/promises'),path=require('node:path'),{spawnSync}=require('node:child_process'),{createHash}=require('node:crypto');
async function main(){
 const [arch,out]=process.argv.slice(2);if(process.platform!=='darwin'||!['arm64','x64'].includes(arch)||!out||!path.isAbsolute(out))throw Error('Use build-native-pdf.cjs arm64|x64 ABSOLUTE_NEW_OUTPUT on a Mac with the installed SDK.');
 await fs.mkdir(out,{mode:0o700});const binary=path.join(out,'neyvu-pdf-reader'),source=path.join(__dirname,'native-pdf.swift');
 const run=(cmd,args)=>{const r=spawnSync(cmd,args,{encoding:'utf8',env:{PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8'},timeout:180000,maxBuffer:1000000});if(r.status!==0)throw Error(r.stderr||'Local native reader build failed.');return r.stdout.trim();};
 const sdk=run('/usr/bin/xcrun',['--show-sdk-path']);
 run('/usr/bin/xcrun',['swiftc','-O','-target',(arch==='arm64'?'arm64':'x86_64')+'-apple-macos13.0','-sdk',sdk,source,'-o',binary]);
 run('/usr/bin/codesign',['--force','--sign','-',binary]);run('/usr/bin/codesign',['--verify','--strict',binary]);
 if(run('/usr/bin/lipo',['-archs',binary])!==(arch==='arm64'?'arm64':'x86_64'))throw Error('Compiled reader architecture differs.');await fs.chmod(binary,0o700);
 const sha=b=>createHash('sha256').update(b).digest('hex'),record={format:'neyvu-native-reader-package/1',protocol:'neyvu-native-pdf/1',version:'1',platform:'macos',architecture:arch,file:'neyvu-pdf-reader',source_sha256:sha(await fs.readFile(source)),binary_sha256:sha(await fs.readFile(binary)),local_signature:'ad-hoc',publisher_verified:false,notarized:false,distribution_qualified:false,new_download:false,hosted_build:false};await fs.writeFile(path.join(out,'native-reader.json'),JSON.stringify(record,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify(record));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
