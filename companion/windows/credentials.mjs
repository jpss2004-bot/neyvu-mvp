import {spawn} from 'node:child_process';
// DPAPI binds saved connection credentials and session cookies to this Windows account.
export async function protect(value,decrypt=false){
 const script=`Add-Type -AssemblyName System.Security; $s=[Console]::In.ReadToEnd(); $b=${decrypt?'[Convert]::FromBase64String($s)':'[Text.Encoding]::UTF8.GetBytes($s)'}; $r=[Security.Cryptography.ProtectedData]::${decrypt?'Unprotect':'Protect'}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write(${decrypt?'[Text.Encoding]::UTF8.GetString($r)':'[Convert]::ToBase64String($r)'})`;
 return new Promise((resolve,reject)=>{const p=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{stdio:['pipe','pipe','pipe'],windowsHide:true});let result='';p.stdout.on('data',d=>result+=d);p.stderr.resume();p.on('error',()=>reject(Error('Windows credential storage is unavailable.')));p.on('exit',code=>code===0?resolve(result):reject(Error('Windows credential storage is unavailable.')));p.stdin.end(value);});
}
