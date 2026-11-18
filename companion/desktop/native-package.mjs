// The pin lives inside the integrity-checked ASAR. Only its matching executable
// is accepted from the external resource folder; no source/runtime compilation.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {createNativePdfReader,verifyNativePdfHelper} from './native-pdf-reader.mjs';
const keys=['format','protocol','version','platform','architecture','file','source_sha256','binary_sha256','local_signature','publisher_verified','notarized','distribution_qualified','new_download','hosted_build'];
export function validateNativePackage(m,{architecture}){
 if(!m||typeof m!=='object'||Array.isArray(m)||Object.keys(m).length!==keys.length||keys.some(k=>!Object.hasOwn(m,k))||m.format!=='neyvu-native-reader-package/1'||m.protocol!=='neyvu-native-pdf/1'||m.version!=='1'||m.platform!=='macos'||m.architecture!==architecture||!['arm64','x64'].includes(architecture)||m.file!=='neyvu-pdf-reader'||! /^[a-f0-9]{64}$/.test(m.source_sha256)||! /^[a-f0-9]{64}$/.test(m.binary_sha256)||m.local_signature!=='ad-hoc'||m.publisher_verified!==false||m.notarized!==false||m.distribution_qualified!==false||m.new_download!==false||m.hosted_build!==false)throw Error('This copy has an incompatible native reader package. Keep retained originals and use the matching Companion.');
 return JSON.parse(JSON.stringify(m));
}
export async function loadPackagedNativeReader({appRoot,resourcesRoot,platform=process.platform,architecture=process.arch}){
 let raw;try{raw=await fs.readFile(path.join(appRoot,'native-reader.json'),'utf8');}catch(e){if(e.code==='ENOENT')return null;throw e;}
 if(platform!=='darwin'||raw.length>4096)throw Error('This Companion has a native reader for a different platform.');
 let parsed;try{parsed=JSON.parse(raw);}catch{throw Error('The native reader package record could not be read.');}
 const manifest=validateNativePackage(parsed,{architecture}),folder=path.join(resourcesRoot,'native-pdf'),st=await fs.lstat(folder);
 if(!st.isDirectory()||st.isSymbolicLink()||await fs.realpath(folder)!==path.resolve(folder)||(await fs.readdir(folder)).join('|')!=='neyvu-pdf-reader')throw Error('The native reader resource folder did not pass its file check.');
 const executable=path.join(folder,manifest.file);await verifyNativePdfHelper({executable,artifactSHA256:manifest.binary_sha256});
 return {manifest,readPdf:createNativePdfReader({executable,artifactSHA256:manifest.binary_sha256})};
}
