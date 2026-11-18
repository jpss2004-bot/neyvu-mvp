import {randomBytes} from 'node:crypto';

// One renderer for every Neyvu email, so they share a look and a plain-text twin.
// Mail clients ignore stylesheets and SVG and many force dark mode, so the HTML is
// table-based with inline styles, the logo is a PNG on a white plate, and every
// value is escaped. Only https links (or local http for test runs) are rendered.
export type EmailLanguage='en'|'es';
export type EmailLink={label:string;url:string};
export type EmailBlock=
 |{kind:'paragraph';text:string}
 |{kind:'steps';title?:string;items:string[]}
 |{kind:'details';rows:[string,string][]}
 |{kind:'links';title?:string;items:EmailLink[]}
 |{kind:'note';text:string};
// actionAt places the button before that block (default: after the last block).
export type NeyvuEmail={language:EmailLanguage;origin:string;preheader:string;heading:string;blocks:EmailBlock[];action?:EmailLink;actionAt?:number;footer:string[];signoff:string};

const ink='#181b25',muted='#646b7d',line='#dce0e9',paper='#f5f6fa',accent='#2457cc',noteSurface='#f2f5fd';
const font="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
export const escapeHtml=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
export function safeEmailUrl(value:string){
 const u=new URL(value);
 if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname))||u.username||u.password)throw Error('Unsafe email link');
 return u.href;
}

export function renderEmailText(email:NeyvuEmail){
 const out=[email.heading,''],at=email.actionAt??email.blocks.length;
 const action=()=>{if(email.action)out.push(`${email.action.label}: ${safeEmailUrl(email.action.url)}`,'');};
 for(const [index,block] of email.blocks.entries()){
  if(index===at)action();
  if(block.kind==='paragraph'||block.kind==='note')out.push(block.text,'');
  if(block.kind==='steps'){if(block.title)out.push(block.title);block.items.forEach((item,i)=>out.push(`${i+1}. ${item}`));out.push('');}
  if(block.kind==='details'){for(const [label,value] of block.rows)out.push(`${label}: ${value}`);out.push('');}
  if(block.kind==='links'){if(block.title)out.push(block.title);for(const link of block.items)out.push(`- ${link.label}: ${safeEmailUrl(link.url)}`);out.push('');}
 }
 if(at>=email.blocks.length)action();
 out.push(...email.footer,'',email.signoff);
 return out.join('\r\n');
}

function blockHtml(block:EmailBlock){
 const p=`margin:0 0 18px;font:16px/1.6 ${font};color:${ink};`;
 const title=(text?:string)=>text?`<p class="nv-text" style="margin:0 0 8px;font:600 15px/1.5 ${font};color:${ink};">${escapeHtml(text)}</p>`:'';
 if(block.kind==='paragraph')return `<p class="nv-text" style="${p}">${escapeHtml(block.text)}</p>`;
 if(block.kind==='note')return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;border-collapse:separate;"><tr><td class="nv-note" style="background:${noteSurface};border-left:3px solid ${accent};border-radius:8px;padding:12px 16px;font:15px/1.55 ${font};color:${ink};">${escapeHtml(block.text)}</td></tr></table>`;
 if(block.kind==='steps')return title(block.title)+`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;">`+block.items.map((item,i)=>`<tr><td valign="top" width="30" style="padding:0 0 10px;"><div style="width:22px;height:22px;border-radius:11px;background:${accent};color:#ffffff;font:600 13px/22px ${font};text-align:center;">${i+1}</div></td><td class="nv-text" style="padding:1px 0 10px;font:16px/1.5 ${font};color:${ink};">${escapeHtml(item)}</td></tr>`).join('')+`</table>`;
 if(block.kind==='details')return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;border-top:1px solid ${line};">`+block.rows.map(([label,value])=>`<tr><td class="nv-muted" style="padding:10px 12px 10px 0;border-bottom:1px solid ${line};font:14px/1.4 ${font};color:${muted};white-space:nowrap;" valign="top">${escapeHtml(label)}</td><td class="nv-text" style="padding:10px 0;border-bottom:1px solid ${line};font:15px/1.4 ${font};color:${ink};word-break:break-word;">${escapeHtml(value)}</td></tr>`).join('')+`</table>`;
 return title(block.title)+`<p style="${p}">`+block.items.map(link=>`<a class="nv-link" href="${escapeHtml(safeEmailUrl(link.url))}" style="color:${accent};text-decoration:underline;">${escapeHtml(link.label)}</a>`).join('<br>')+`</p>`;
}

export function renderEmailHtml(email:NeyvuEmail){
 const origin=safeEmailUrl(email.origin).replace(/\/$/,''),logo=escapeHtml(origin+'/brand/email/neyvu-email-logo.png');
 const action=email.action?`<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 24px;"><tr><td bgcolor="${accent}" style="border-radius:10px;"><a class="nv-button" href="${escapeHtml(safeEmailUrl(email.action.url))}" style="display:inline-block;padding:14px 26px;font:600 16px/1 ${font};color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(email.action.label)}</a></td></tr></table>`:'';
 return `<!doctype html><html lang="${email.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${escapeHtml(email.heading)}</title>`+
 `<style>@media (prefers-color-scheme:dark){.nv-body{background:#101117!important}.nv-card{background:#1c1e27!important;border-color:#363946!important}.nv-text,.nv-heading{color:#f0f1f7!important}.nv-muted{color:#acb1c0!important}.nv-note{background:#272c43!important;color:#f0f1f7!important}.nv-link{color:#9daeff!important}}@media (max-width:600px){.nv-card{padding:24px 20px!important}}</style></head>`+
 `<body class="nv-body" style="margin:0;padding:0;background:${paper};">`+
 `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(email.preheader)}</div>`+
 `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="nv-body" style="background:${paper};"><tr><td align="center" style="padding:28px 12px;">`+
 `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">`+
 `<tr><td style="padding:0 4px 18px;"><a href="${escapeHtml(origin+'/beta')}"><img src="${logo}" width="150" height="44" alt="Neyvu" style="display:block;border:0;"></a></td></tr>`+
 `<tr><td class="nv-card" style="background:#ffffff;border:1px solid ${line};border-radius:16px;padding:32px;">`+
 `<h1 class="nv-heading" style="margin:0 0 18px;font:700 24px/1.25 ${font};color:${ink};">${escapeHtml(email.heading)}</h1>`+
 (()=>{const at=email.actionAt??email.blocks.length,parts=email.blocks.map(blockHtml);parts.splice(at,0,action);return parts.join('');})()+
 email.footer.map(text=>`<p class="nv-muted" style="margin:0 0 10px;font:14px/1.55 ${font};color:${muted};">${escapeHtml(text)}</p>`).join('')+
 `<p class="nv-text" style="margin:18px 0 0;font:600 15px/1.5 ${font};color:${ink};">${escapeHtml(email.signoff)}</p>`+
 `</td></tr></table></td></tr></table></body></html>`;
}

const base64Lines=(value:string)=>Buffer.from(value,'utf8').toString('base64').match(/.{1,76}/g)!.join('\r\n');
const encodeSubject=(subject:string)=>/^[\x20-\x7e]*$/.test(subject)?subject:`=?UTF-8?B?${Buffer.from(subject,'utf8').toString('base64')}?=`;
// A multipart/alternative message: clients that cannot show HTML read the plain-text part.
export function emailMessage(input:{to:string;subject:string;messageId:string;email:NeyvuEmail}){
 if(/[\r\n<>]/.test(input.to)||/[\r\n]/.test(input.subject)||!/^[A-Za-z0-9.@_+-]+$/.test(input.messageId))throw Error('Invalid email header');
 const boundary='neyvu-'+randomBytes(12).toString('hex');
 return ['From: Neyvu <neyvu.support@example.com>',`To: <${input.to}>`,`Subject: ${encodeSubject(input.subject)}`,`Date: ${new Date().toUTCString()}`,`Message-ID: <${input.messageId}>`,'MIME-Version: 1.0',`Content-Type: multipart/alternative; boundary="${boundary}"`,'',
  `--${boundary}`,'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',base64Lines(renderEmailText(input.email)),
  `--${boundary}`,'Content-Type: text/html; charset=UTF-8','Content-Transfer-Encoding: base64','',base64Lines(renderEmailHtml(input.email)),
  `--${boundary}--`,''].join('\r\n');
}
// Tests and the local log transport read a part back out of a built message.
export function emailPart(message:string,type:'text/plain'|'text/html'){
 const boundary=message.match(/boundary="([^"]+)"/)?.[1];if(!boundary)throw Error('Not a Neyvu multipart email');
 const part=message.split('--'+boundary).find(section=>section.includes('Content-Type: '+type));if(!part)throw Error('Missing '+type+' part');
 return Buffer.from(part.split('\r\n\r\n')[1].replace(/\s/g,''),'base64').toString('utf8');
}
