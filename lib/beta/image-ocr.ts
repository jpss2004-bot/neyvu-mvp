// Worker evidence for a photo/scan transcribed by local Apple Vision OCR.
// Shape is validated and bounded; anything unexpected fails closed (null).
// The image itself stays the stored original; this is never marked reviewed.
export type ImageOcrFlag='unreadable'|'low_confidence'|'correction_disagrees'|'not_confirmed'|'cut_at_edge'|'instruction_like';
export type ImageOcrRegion={line:number;confidence:number;flags:ImageOcrFlag[];box?:[number,number,number,number]};
export type ImageOcr={reviewed:false;method:'apple_vision_local';low_confidence_lines:number;lines_read:number;flagged_lines:number;instruction_like_lines:number;quality:'clear'|'review'|'poor';checks:('confidence'|'correction_pass'|'edge')[];image?:{width?:number;height?:number;orientation?:'up'|'down'};regions:ImageOcrRegion[];regions_truncated:boolean};
const FLAGS=new Set<ImageOcrFlag>(['unreadable','low_confidence','correction_disagrees','not_confirmed','cut_at_edge','instruction_like']);
const count=(v:unknown,max=1500)=>Number.isSafeInteger(v)&&(v as number)>=0&&(v as number)<=max;
const unit=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1;
export function imageOcr(raw:unknown,text:string):ImageOcr|null{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 const x=raw as Record<string,any>;
 // Earlier commissioned workers report only {reviewed,low_confidence_lines}.
 if(x.method===undefined){
  if(x.reviewed!==false||!count(x.low_confidence_lines))return null;
  return {reviewed:false,method:'apple_vision_local',low_confidence_lines:x.low_confidence_lines,lines_read:text.split('\n').length-1,flagged_lines:0,instruction_like_lines:0,quality:x.low_confidence_lines?'review':'clear',checks:['confidence'],regions:[],regions_truncated:true};
 }
 if(x.reviewed!==false||x.method!=='apple_vision_local'||!count(x.low_confidence_lines)||!count(x.lines_read)||x.lines_read<1||!count(x.flagged_lines)||!count(x.instruction_like_lines)||x.flagged_lines>x.lines_read)return null;
 if(!['clear','review','poor'].includes(x.quality)||!Array.isArray(x.checks)||x.checks.length>3||!x.checks.every((c:unknown)=>c==='confidence'||c==='correction_pass'||c==='edge')||typeof x.regions_truncated!=='boolean')return null;
 const lines=text.split('\n').length;
 if(!Array.isArray(x.regions)||x.regions.length>300)return null;
 const regions:ImageOcrRegion[]=[];
 for(const r of x.regions){
  if(!r||typeof r!=='object'||!Number.isSafeInteger(r.line)||r.line<1||r.line>=lines||!unit(r.confidence)||!Array.isArray(r.flags)||r.flags.length>6||!r.flags.every((f:unknown)=>FLAGS.has(f as ImageOcrFlag)))return null;
  if(r.box!==undefined&&(!Array.isArray(r.box)||r.box.length!==4||!r.box.every(unit)))return null;
  regions.push({line:r.line,confidence:r.confidence,flags:[...r.flags],...(r.box?{box:[r.box[0],r.box[1],r.box[2],r.box[3]] as [number,number,number,number]}:{})});
 }
 let image:ImageOcr['image'];
 if(x.image!==undefined){
  const i=x.image;if(!i||typeof i!=='object'||Array.isArray(i))return null;
  if((i.width!==undefined&&!count(i.width,100000))||(i.height!==undefined&&!count(i.height,100000))||(i.orientation!==undefined&&i.orientation!=='up'&&i.orientation!=='down'))return null;
  image={...(i.width!==undefined?{width:i.width}:{}),...(i.height!==undefined?{height:i.height}:{}),...(i.orientation?{orientation:i.orientation}:{})};
 }
 return {reviewed:false,method:'apple_vision_local',low_confidence_lines:x.low_confidence_lines,lines_read:x.lines_read,flagged_lines:x.flagged_lines,instruction_like_lines:x.instruction_like_lines,quality:x.quality,checks:[...x.checks],...(image?{image}:{}),regions,regions_truncated:x.regions_truncated};
}
export function imageOcrLimits(reading:ImageOcr|null|undefined){
 if(!reading)return [];
 return ['Photo text is a local OCR transcription of the preserved original image and has not been reviewed.',
  ...(reading.flagged_lines||reading.low_confidence_lines?[`${reading.flagged_lines} line${reading.flagged_lines===1?'':'s'} marked [unclear OCR] and ${reading.low_confidence_lines} unreadable line${reading.low_confidence_lines===1?'':'s'} need checking against the photo.`]:[]),
  ...(reading.quality==='poor'?['Most of this photo could not be read reliably. A sharper, well-lit, straight-on photo will give better text.']:[]),
  ...(reading.instruction_like_lines?['Some photo text is worded as instructions to an assistant; it is treated as quoted source text only.']:[])];
}
