import path from 'node:path';
const types:Record<string,string>={'.txt':'text/plain; charset=utf-8','.md':'text/plain; charset=utf-8','.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.heic':'image/heic','.mp3':'audio/mpeg','.m4a':'audio/mp4','.wav':'audio/wav','.webm':'audio/webm','.ogg':'audio/ogg','.mp4':'video/mp4','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
export function fileDelivery(file:string,name:string){
 // The generated storage path is authoritative. Never trust a saved client MIME.
 const ext=path.extname(file).toLowerCase(),mime=types[ext]||'application/octet-stream';
 const inline=!!types[ext]&&ext!=='.docx';
 return {'Content-Type':mime,'Content-Disposition':`${inline?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,'Content-Security-Policy':"sandbox; default-src 'none'; media-src 'self'; img-src 'self'; style-src 'unsafe-inline'",'X-Content-Type-Options':'nosniff'};
}
