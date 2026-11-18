import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
// Connector tokens are sealed with AES-256-GCM before they reach Postgres. The
// key lives only in the web process environment (NEYVU_CONNECTOR_TOKEN_KEY,
// 32 bytes base64). The additional data binds a box to one learner, account and
// connector kind, so a box copied to another row cannot be opened.
export const tokenKeyVersion=1;
function key(env:Record<string,string|undefined>=process.env){
 const raw=env.NEYVU_CONNECTOR_TOKEN_KEY;const bytes=raw?Buffer.from(raw,'base64'):Buffer.alloc(0);
 if(bytes.length!==32)throw Error('Connector token storage is not configured');
 return bytes;
}
export function sealToken(value:unknown,binding:string,env=process.env):string{
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(env),iv);cipher.setAAD(Buffer.from(binding));
 const body=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
 return `v${tokenKeyVersion}.`+Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64url');
}
export function openToken<T=any>(box:string,binding:string,env=process.env):T{
 if(typeof box!=='string'||!box.startsWith(`v${tokenKeyVersion}.`))throw Error('Connector token is unreadable');
 const bytes=Buffer.from(box.slice(3),'base64url');if(bytes.length<29)throw Error('Connector token is unreadable');
 const decipher=createDecipheriv('aes-256-gcm',key(env),bytes.subarray(0,12));decipher.setAAD(Buffer.from(binding));decipher.setAuthTag(bytes.subarray(12,28));
 return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8'));
}
export const accountBinding=(user:string,account:string,kind:string)=>`neyvu-connector:${user}:${account}:${kind}`;
export const handshakeBinding=(user:string,stateHash:string,kind:string)=>`neyvu-handshake:${user}:${stateHash}:${kind}`;
