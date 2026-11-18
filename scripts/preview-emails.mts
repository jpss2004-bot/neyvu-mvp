// Renders every Neyvu email to HTML and text files for review. It sends nothing and
// needs no database. Usage: node --import tsx scripts/preview-emails.mts ABSOLUTE_NEW_FOLDER
import fs from 'node:fs';
import path from 'node:path';
import {renderEmailHtml,renderEmailText,type NeyvuEmail} from '../lib/beta/email-design';
import {adminSignInEmail,approvalEmail,requestNoticeEmail} from '../lib/beta/neyvu-emails';
const out=process.argv[2];
if(!out||!path.isAbsolute(out)||fs.existsSync(out))throw Error('Give a new absolute output folder.');
const origin='https://neyvu-app.example.com',student={origin,email:'sample.student@example.com',name:'Sample Student'};
const previews:[string,{subject:string;email:NeyvuEmail}][]=[
 ['approval-en',approvalEmail({...student,invitation:false,language:'en'})],
 ['approval-es',approvalEmail({...student,invitation:false,language:'es'})],
 ['invitation-en',approvalEmail({...student,invitation:true,language:'en'})],
 ['invitation-es',approvalEmail({...student,invitation:true,language:'es'})],
 ['admin-sign-in',adminSignInEmail({origin,link:origin+'/beta/admin/confirm#preview-only-not-a-real-token'})],
 ['request-notice',requestNoticeEmail({origin,name:'Sample Student',email:'sample.student@example.com',id:'00000000-0000-4000-8000-000000000000',language:'es'})],
];
fs.mkdirSync(out);fs.copyFileSync(path.resolve('public/brand/email/neyvu-email-logo.png'),path.join(out,'neyvu-email-logo.png'));
const rows:string[]=[];
for(const [name,{subject,email}] of previews){
 // The deployed logo URL is swapped for the local copy so previews render before release.
 fs.writeFileSync(path.join(out,name+'.html'),renderEmailHtml(email).replace(origin+'/brand/email/neyvu-email-logo.png','neyvu-email-logo.png'));
 fs.writeFileSync(path.join(out,name+'.txt'),renderEmailText(email));
 rows.push(`<li><a href="${name}.html">${name}</a>: ${subject.replace(/</g,'&lt;')}</li>`);
}
fs.writeFileSync(path.join(out,'index.html'),`<!doctype html><meta charset="utf-8"><title>Neyvu email previews</title><ul>${rows.join('')}</ul>`);
console.log(JSON.stringify({written:previews.length,out}));
