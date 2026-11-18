// Device observations, never certified matrix cells, reading order or meaning.
// Ranges use the exact UTF-8 page body already bound by the PDF manifest.
import {createHash} from 'node:crypto';
import {BetaHttpError} from './http';
export const pdfLineGeometryFormat='neyvu-pdf-lines/1';
type Box={x:number;y:number;width:number;height:number};
export type PdfLineGeometry={format:typeof pdfLineGeometryFormat;reviewed:false;reading_order:'not_verified';native_coordinates:'pdf_points_bottom_left';ocr_coordinates:'normalized_bottom_left';page:{width:number;height:number;origin_x:number;origin_y:number;rotation:number};native_lines_total:number;native_lines_unmapped:number;ocr_lines_total:number;lines:{id:string;method:'native_text'|'ocr';start:number;end:number;sha256:string;box:Box;confidence:number|null}[]};
const fail=()=>{throw new BetaHttpError('PDF line geometry does not match the exact unreviewed page observation.',400);};
const keys=(v:any,names:string[])=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==names.length||names.some(k=>!Object.hasOwn(v,k)))fail();};
const int=(v:any,min:number,max:number)=>{if(!Number.isSafeInteger(v)||v<min||v>max)fail();};
export function validatePdfLineGeometry(raw:unknown,page:{number:number;state:string;issues:readonly string[];blocks:readonly {start:number;end:number;method:string}[]},platform:string){
 const g=raw as PdfLineGeometry;keys(g,['format','reviewed','reading_order','native_coordinates','ocr_coordinates','page','native_lines_total','native_lines_unmapped','ocr_lines_total','lines']);
 if(g.format!==pdfLineGeometryFormat||g.reviewed!==false||g.reading_order!=='not_verified'||g.native_coordinates!=='pdf_points_bottom_left'||g.ocr_coordinates!=='normalized_bottom_left'||!page.issues.includes('layout_unverified')||page.state!=='partial')fail();
 keys(g.page,['width','height','origin_x','origin_y','rotation']);
 if([g.page.width,g.page.height,g.page.origin_x,g.page.origin_y].some(v=>typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>20000)||g.page.width<=0||g.page.height<=0||!Number.isSafeInteger(g.page.rotation)||Math.abs(g.page.rotation)>360||g.page.rotation%90!==0)fail();
 for(const n of [g.native_lines_total,g.native_lines_unmapped,g.ocr_lines_total])int(n,0,20000);
 if(!Array.isArray(g.lines)||g.lines.length>20000)fail();
 const ids=new Set();let native=0,ocr=0;
 for(const line of g.lines){
  keys(line,['id','method','start','end','sha256','box','confidence']);if(!['native_text','ocr'].includes(line.method))fail();
  const kind=line.method==='ocr'?'o':'n',match=new RegExp('^p'+page.number+'-'+kind+'([1-9]\\d{0,4})$').exec(line.id);
  if(!match||ids.has(line.id)||Number(match[1])>(kind==='o'?g.ocr_lines_total:g.native_lines_total))fail();ids.add(line.id);
  int(line.start,0,512000);int(line.end,line.start+1,512000);
  if(!/^[a-f0-9]{64}$/.test(line.sha256)||!page.blocks.some(b=>b.method===line.method&&line.start>=b.start&&line.end<=b.end))fail();
  keys(line.box,['x','y','width','height']);const b=line.box;if(Object.values(b).some(v=>typeof v!=='number'||!Number.isFinite(v))||b.width<=0||b.height<=0)fail();
  if(line.method==='ocr'){
   ocr++;if(!page.issues.includes('ocr_unreviewed')||b.x< -0.000001||b.y< -0.000001||b.x+b.width>1.000001||b.y+b.height>1.000001)fail();
   if(line.confidence!==null&&(platform!=='macos'||typeof line.confidence!=='number'||!Number.isFinite(line.confidence)||line.confidence<0||line.confidence>1))fail();
  }else{native++;if(line.confidence!==null||Object.values(b).some(v=>Math.abs(v)>40000))fail();}
 }
 if(native+g.native_lines_unmapped!==g.native_lines_total||ocr!==g.ocr_lines_total)fail();return g.lines.length;
}
export function validatePdfGeometryText(g:PdfLineGeometry,body:Buffer){
 for(const line of g.lines){const bytes=body.subarray(line.start,line.end);let text='';try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{fail();}
  if(!text||line.end>body.length||createHash('sha256').update(bytes).digest('hex')!==line.sha256)fail();}
}
