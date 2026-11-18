import { NextRequest,NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { accountFor,sameOrigin } from '../../../../lib/auth';
import { note,db,dataDirectory,updateNote,setting } from '../../../../lib/store';
import {boundedBody,BodyTooLarge} from '../../../../lib/body';
import {fileDelivery} from '../../../../lib/file-delivery';
let activeUploads=0;
export async function POST(request:NextRequest){
  const account=await accountFor(request.headers.get('host'));if(!account||!sameOrigin(request))return NextResponse.json({error:'Private upload'},{status:401});
  if(Number(request.headers.get('content-length'))>160000000)return NextResponse.json({error:'File exceeds 150 MB'},{status:413});
  if(activeUploads>=2)return NextResponse.json({error:'Two file imports are already running. Please try again shortly.'},{status:429});
  activeUploads++;
  try{
    const bytes=await boundedBody(request,160000000);
    const form=await new Response(bytes,{headers:{'Content-Type':request.headers.get('content-type')||''}}).formData(),file=form.get('file'),id=String(form.get('note')||'');
    const n=note(id,account);if(!n||!(file instanceof File))throw new Error('Choose a note and file');
    if(file.size>150000000)throw new Error('File exceeds 150 MB');
    const ext=path.extname(file.name).toLowerCase();
    const audio=['.mp3','.m4a','.wav','.webm','.ogg'].includes(ext);
    const image=['.png','.jpg','.jpeg','.webp','.heic'].includes(ext);
    const text=['.txt','.md','.pdf','.docx'].includes(ext);
    if(!audio&&!image&&!text)throw new Error('Use an audio recording, image, PDF, Word, text, or Markdown file');
    if(audio&&form.get('lecture')==='true'&&setting('recording:'+n.course,undefined,account)!=='permitted')throw new Error('Confirm lecture recording permission for this course first');
    const ident=randomUUID(),directory=path.join(dataDirectory(),'attachments');await mkdir(directory,{recursive:true,mode:0o700});
    const target=path.join(directory,ident+ext);await writeFile(target,Buffer.from(await file.arrayBuffer()),{mode:0o600});
    db().prepare('INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?)').run(ident,account,id,file.name.slice(0,180),fileDelivery(target,file.name)['Content-Type'],target,audio?'audio':image?'image':'document',new Date().toISOString());
    let extraction='',extracted=false;
    if(text||image){try{const {stdout}=await promisify(execFile)(process.env.SCHOOL_SPEECH_PYTHON || 'python3',[path.join(process.cwd(),'scripts/extract.py'),target],{timeout:60000,maxBuffer:1_000_000});extraction=stdout.trim();if(extraction){const heading='\n\n### Imported: '+file.name+'\n',capacity=80000-n.body.length-heading.length;if(capacity>0){updateNote(id,n.version,{body:n.body+heading+extraction.slice(0,Math.min(60000,capacity))},account);extracted=true;}}}catch{/* Original is retained and visible even when extraction fails. */}}
    return NextResponse.json({ok:true,id:ident,extracted,kind:audio?'audio':image?'image':'document'});
  }catch(error){return NextResponse.json({error:error instanceof BodyTooLarge?'File exceeds 150 MB':error instanceof Error?error.message:'Upload failed'},{status:error instanceof BodyTooLarge?413:400});}finally{activeUploads--;}
}
