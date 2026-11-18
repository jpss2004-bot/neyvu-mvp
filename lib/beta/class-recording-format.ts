import {createHash} from 'node:crypto';
import {BetaHttpError} from './http';
export const recordingLimits={chunkBytes:4*1024*1024,totalBytes:128*1024*1024,chunks:1024,durationMs:2*60*60*1000,segments:5000,textCharacters:240000} as const;
export const recordingMimes=['audio/webm','audio/mp4','audio/ogg','audio/wav','audio/mpeg'] as const;
export type ClassSegment={start_ms:number;end_ms:number;text:string;uncertain:boolean;speaker:'unidentified'};
export const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export function recordingDate(value:unknown,now=Date.now()){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))throw new BetaHttpError('Enter the actual class recording date with its timezone.');
 const [year,month,day]=value.slice(0,10).split('-').map(Number),calendar=new Date(Date.UTC(year,month-1,day)),date=new Date(value);
 if(calendar.getUTCFullYear()!==year||calendar.getUTCMonth()!==month-1||calendar.getUTCDate()!==day||!Number.isFinite(date.getTime())||date.getTime()>now+300000)throw new BetaHttpError('Enter the actual class recording date.');
 return date;
}
export function integer(value:unknown,min:number,max:number){if(!Number.isSafeInteger(value)||Number(value)<min||Number(value)>max)throw new BetaHttpError('Invalid recording value.');return value as number;}
export function audioSignature(mime:string,bytes:Buffer){
 if(mime==='audio/webm')return bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]));
 if(mime==='audio/mp4')return bytes.subarray(4,8).toString()==='ftyp';
 if(mime==='audio/ogg')return bytes.subarray(0,4).toString()==='OggS';
 if(mime==='audio/wav')return bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WAVE';
 if(mime==='audio/mpeg')return bytes.subarray(0,3).toString()==='ID3'||(bytes[0]===255&&(bytes[1]&224)===224);
 return false;
}
export function validateSegments(value:unknown,duration:number):ClassSegment[]{
 if(!Array.isArray(value)||value.length>recordingLimits.segments)throw new BetaHttpError('Invalid transcript segments.');
 let previous=0,total=0;
 const segments=value.map(s=>{
  if(!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).some(k=>!['start_ms','end_ms','text','uncertain','speaker'].includes(k)))throw new BetaHttpError('Invalid transcript segment.');
  const start=integer(s.start_ms,0,duration),end=integer(s.end_ms,0,duration);
  if(start<previous||end<start||typeof s.text!=='string'||s.text.length>10000||s.text.includes('\0')||typeof s.uncertain!=='boolean'||s.speaker!=='unidentified')throw new BetaHttpError('Invalid transcript segment.');
  previous=start;total+=s.text.length;return {start_ms:start,end_ms:end,text:s.text,uncertain:s.uncertain,speaker:'unidentified' as const};
 });
 if(total>recordingLimits.textCharacters)throw new BetaHttpError('This transcript exceeds the current recording limit.',413);
 return segments;
}
export function recordingManifest(mime:string,chunks:{sequence:number;sha256:string;bytes:number}[]){return digest(JSON.stringify({version:1,mime,chunks:chunks.map(c=>({sequence:c.sequence,sha256:c.sha256,bytes:Number(c.bytes)}))}));}
export function transcriptBody(title:string,segments:ClassSegment[],clock?:{recorded_at:string;timezone:string;capture_outcome?:string},boundaries:ClassSegment[]=[]){
 const time=(ms:number)=>{const s=Math.floor(ms/1000);return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(n=>String(n).padStart(2,'0')).join(':');};
 return `# ${title} — class transcript\n\n${clock?`Class recording start (student reported): ${clock.recorded_at}; class timezone: ${clock.timezone}. Resolve relative speech against this class date, not the transcript processing date. Capture outcome: ${clock.capture_outcome||'unknown'}; recording storage does not establish complete class coverage.\n\n`:''}Student recording; speakers are unidentified. Local speech recognition and student corrections can contain errors. This is not an official Moodle requirement, submission receipt or grade. Verify mathematical notation against the recording and course material.\n\n`+
 (segments.length?segments.map(s=>`[${time(s.start_ms)}–${time(s.end_ms)}]${s.uncertain?' [uncertain speech]':''} ${s.text}`).join('\n'):'No speech was recognized. Check the original recording; this does not establish that no work was assigned.')+(boundaries.length?'\n\n## Speech at processing boundaries — alternatives requiring audio review\n\nThese original machine overlap recognitions can repeat neighboring speech and are uncertain. They do not override student-corrected words in the main transcript. Check the audio before relying on them.\n\n'+boundaries.map(s=>`[${time(s.start_ms)}–${time(s.end_ms)}] [uncertain boundary alternative] ${s.text}`).join('\n'):'');
}
export function recordingRange(value:string|null,size:number){
 if(!value)return {start:0,end:size-1,partial:false};
 const m=value.match(/^bytes=(\d*)-(\d*)$/);if(!m||(!m[1]&&!m[2]))throw new BetaHttpError('Invalid audio range.',416);
 let start:number,end:number;
 if(!m[1]){const suffix=Number(m[2]);if(!Number.isSafeInteger(suffix)||suffix<=0)throw new BetaHttpError('Invalid audio range.',416);start=Math.max(0,size-suffix);end=size-1;}
 else{start=Number(m[1]);end=m[2]?Number(m[2]):size-1;}
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)throw new BetaHttpError('Invalid audio range.',416);
 return {start,end:Math.min(end,size-1),partial:true};
}
