import { NextRequest } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { accountFor } from '../../../../../lib/auth';
import { bridge } from '../../../../../lib/bridge';
import { db, note } from '../../../../../lib/store';
import {fileDelivery} from '../../../../../lib/file-delivery';
export const runtime='nodejs';
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){
  const account=await accountFor(request.headers.get('host'));if(!account)return new Response('Private file',{status:401});
  try{
    const {id}=await params;
    const savedNote=note(id,account);
    if(savedNote)return new Response('# '+savedNote.title+'\n\n'+savedNote.body+'\n\n'+savedNote.transcript,{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
    const processed=db().prepare('SELECT result FROM jobs WHERE id=? AND account=?').get(id,account) as {result:string}|undefined;
    if(processed?.result)return new Response(processed.result,{headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
    const attachment=db().prepare('SELECT file_path,name,mime FROM attachments WHERE id=? AND account=?').get(id,account) as {file_path:string;name:string;mime:string}|undefined;
    const source=attachment?null:await bridge('file',{id});
    const file=attachment?.file_path||source._path;
    const name=attachment?.name||path.basename(file);
    const bytes=await readFile(file);
    const headers:Record<string,string>={...fileDelivery(file,name),'Cache-Control':'private, no-store','Accept-Ranges':'bytes'};
    const range=request.headers.get('range');
    if(range){
      const match=/^bytes=(\d*)-(\d*)$/.exec(range);
      let start=0,end=bytes.length-1;
      if(!match)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${bytes.length}`}});
      if(!match[1])start=Math.max(0,bytes.length-Number(match[2]));else{start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]));}
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=bytes.length)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${bytes.length}`}});
      return new Response(bytes.subarray(start,end+1),{status:206,headers:{...headers,'Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Content-Length':String(end-start+1)}});
    }
    return new Response(bytes,{headers:{...headers,'Content-Length':String(bytes.length)}});
  }catch{return new Response('File unavailable',{status:404});}
}
