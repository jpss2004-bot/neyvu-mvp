// Pinned local macOS bridge. Raw page/line geometry is retained locally; the
// negotiated PDF v1 projection explicitly remains partial and unreviewed.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
const hash=x=>createHash('sha256').update(x).digest('hex');
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const keys=(v,ks)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===ks.length&&ks.every(k=>Object.hasOwn(v,k));
const fail=()=>{throw Error('The local PDF reader observation did not match its pinned format. Original retained.');};
const text=(s,max=512000)=>typeof s==='string'&&!s.includes('\0')&&Buffer.byteLength(s)<=max&&new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Buffer.from(s))===s;
function box(b,normalized){if(!keys(b,['x','y','width','height'])||Object.values(b).some(v=>typeof v!=='number'||!Number.isFinite(v))||b.width<=0||b.height<=0)fail();if(normalized){if(b.x< -0.000001||b.y< -0.000001||b.x+b.width>1.000001||b.y+b.height>1.000001)fail();}else if(Object.values(b).some(v=>Math.abs(v)>40000))fail();}
export function projectNativePdf(raw,{originalSHA256,artifactSHA256,lineGeometry=false}){
 if(typeof lineGeometry!=='boolean'||typeof raw!=='string'||Buffer.byteLength(raw)>3000000||!hex(originalSHA256)||!hex(artifactSHA256))fail();let o;try{o=JSON.parse(raw);}catch{fail();}
 if(!keys(o,['format','version','original_sha256','page_count','pages','languages','native_coordinates','ocr_coordinates','language_correction'])||o.format!=='neyvu-native-pdf/1'||o.version!=='1'||o.original_sha256!==originalSHA256||!Number.isSafeInteger(o.page_count)||o.page_count<1||o.page_count>500||!Array.isArray(o.pages)||o.pages.length!==o.page_count||!Array.isArray(o.languages)||new Set(o.languages).size!==o.languages.length||o.languages.some(v=>!['en-US','es-ES'].includes(v))||o.native_coordinates!=='pdf_points_bottom_left'||o.ocr_coordinates!=='normalized_bottom_left'||o.language_correction!==false)fail();
 let allBytes=0,totalLines=0,hasOCR=false;
 const pages=o.pages.map((p,i)=>{
  if(!keys(p,['number','pdf_label','width','height','origin_x','origin_y','rotation','native_text','native_lines','ocr_status','ocr_lines'])||p.number!==i+1||p.pdf_label!==null&&(!text(p.pdf_label,160)||p.pdf_label.length>40||!p.pdf_label.trim()||/[\x00-\x1f\x7f]/.test(p.pdf_label))||[p.width,p.height,p.origin_x,p.origin_y].some(v=>typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>20000)||p.width<=0||p.height<=0||!Number.isInteger(p.rotation)||Math.abs(p.rotation)>360||p.rotation%90!==0||!text(p.native_text)||!Array.isArray(p.native_lines)||!Array.isArray(p.ocr_lines)||!['ok','error','budget','unavailable'].includes(p.ocr_status)||p.ocr_status!=='ok'&&p.ocr_lines.length||p.ocr_lines.length&&!o.languages.length)fail();
  for(const line of p.native_lines){if(!keys(line,['text','box'])||!text(line.text)||!line.text)fail();box(line.box,false);}
  for(const line of p.ocr_lines){if(!keys(line,['text','confidence','box'])||!text(line.text)||!line.text||typeof line.confidence!=='number'||!Number.isFinite(line.confidence)||line.confidence<0||line.confidence>1)fail();box(line.box,true);}
  totalLines+=p.native_lines.length+p.ocr_lines.length;if(totalLines>20000)fail();
  const parts=[],blocks=[],lines=[];let offset=0,unmapped=0;
  const add=(value,kind,method,parent=null)=>{if(!value)return;const start=offset;parts.push(value);offset+=Buffer.byteLength(value);const id='p'+(i+1)+'-b'+(blocks.length+1);blocks.push({id,kind,start,end:offset,method,parent});return id;};
  if(p.native_text.trim()){const h=add('Selectable text (device observed)\n','heading','native_text'),base=offset;add(p.native_text+'\n','paragraph','native_text',h);
   if(lineGeometry)for(const [n,l] of p.native_lines.entries()){const at=p.native_text.indexOf(l.text);if(at<0||p.native_text.indexOf(l.text,at+1)>=0){unmapped++;continue;}const start=base+Buffer.byteLength(p.native_text.slice(0,at));lines.push({id:'p'+(i+1)+'-n'+(n+1),method:'native_text',start,end:start+Buffer.byteLength(l.text),sha256:hash(l.text),box:{...l.box},confidence:null});}
  }else unmapped=p.native_lines.length;
  if(p.ocr_lines.length){hasOCR=true;const h=add('OCR text (device observed; compare the original)\n','heading','ocr'),base=offset;add(p.ocr_lines.map(l=>l.text).join('\n')+'\n','paragraph','ocr',h);
   if(lineGeometry){let at=base;for(const [n,l] of p.ocr_lines.entries()){lines.push({id:'p'+(i+1)+'-o'+(n+1),method:'ocr',start:at,end:at+Buffer.byteLength(l.text),sha256:hash(l.text),box:{...l.box},confidence:l.confidence});at+=Buffer.byteLength(l.text+'\n');}}
  }
  const value=parts.join('');allBytes+=Buffer.byteLength('Page '+(i+1)+'\n'+value+'\n\n');if(allBytes>512000)throw Error('The complete PDF observation exceeds the text budget. Original retained; no pages were silently dropped.');
  const issues=['layout_unverified','equation_unverified','table_unverified','visual_unread'];if(p.ocr_lines.length)issues.push('ocr_unreviewed');if(p.ocr_status!=='ok'||!value)issues.push('text_incomplete');if(p.ocr_status==='error')issues.push('reader_error');if(o.languages.length<2)issues.push('unsupported');
  const geometry=lineGeometry?{geometry:{format:'neyvu-pdf-lines/1',reviewed:false,reading_order:'not_verified',native_coordinates:o.native_coordinates,ocr_coordinates:o.ocr_coordinates,page:{width:p.width,height:p.height,origin_x:p.origin_x,origin_y:p.origin_y,rotation:p.rotation},native_lines_total:p.native_lines.length,native_lines_unmapped:unmapped,ocr_lines_total:p.ocr_lines.length,lines}}:{};
  return {text:value,printed_label:null,state:'partial',issues,blocks,...geometry,...(p.ocr_lines.length?{ocr:{engine:'apple_vision',confidence:Math.min(...p.ocr_lines.map(l=>l.confidence)),confidence_basis:'minimum_reported_line'}}:{})};
 });
 return {extractor:{id:'neyvu-pdfkit-vision',version:'1',artifact_sha256:artifactSHA256,platform:'macos',method:hasOCR?'native_with_ocr':'native_text',languages:[...o.languages]},pages,readerEvidence:{format:'neyvu-native-pdf/1',original_sha256:originalSHA256,sha256:hash(raw),bytes:Buffer.byteLength(raw),body:raw}};
}
export async function verifyNativePdfHelper({executable,artifactSHA256}){const st=await fs.lstat(executable);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size>40*1024*1024||!(st.mode&0o111)||st.mode&0o022||await fs.realpath(executable)!==path.resolve(executable)||hash(await fs.readFile(executable))!==artifactSHA256)throw Error('The local PDF reader did not pass its file hash check.');}
export function createNativePdfReader({executable,artifactSHA256,timeoutMs=90000}){
 if(process.platform!=='darwin'||!path.isAbsolute(executable)||!hex(artifactSHA256)||!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>90000)throw Error('A pinned local Mac PDF reader is required.');
 const check=()=>verifyNativePdfHelper({executable,artifactSHA256});
 return async(original,{signal=undefined,lineGeometry=false}={})=>{
  if(!Buffer.isBuffer(original)||original.length>10*1024*1024||!original.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error('Keep a complete original PDF within the 10 MiB limit.');
  await check();if(signal?.aborted)throw Error('Local PDF reading interrupted; original retained.');
  const raw=await new Promise((resolve,reject)=>{
   let done=false,bytes=0;const chunks=[];
   const child=spawn('/usr/bin/sandbox-exec',['-p','(version 1)(allow default)(deny network*)',executable,'pdf-v1'],{stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8'},windowsHide:true});
   const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error){if(child.exitCode!==null||child.signalCode!==null||!child.pid)reject(error);else{child.once('close',()=>reject(error));child.kill('SIGKILL');}}else resolve(value);};
   const abort=()=>finish(Error('Local PDF reading interrupted; original retained.'));
   const timer=setTimeout(()=>finish(Error('Local PDF reading exceeded its time budget; original retained.')),timeoutMs);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
   child.on('error',()=>finish(Error('The local PDF reader could not start; original retained.')));child.stdin.on('error',()=>{});child.stderr.resume();
   child.stdout.on('data',part=>{if(done)return;bytes+=part.length;if(bytes>3000000)return finish(Error('The local PDF reader exceeded its output budget; original retained.'));chunks.push(part);});
   child.on('close',code=>{if(code!==0)return finish(Error('This PDF could not be read completely on this device. Original retained.'));try{finish(null,new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Buffer.concat(chunks)));}catch{finish(Error('Local PDF output was not exact UTF-8; original retained.'));}});
   child.stdin.end(original);
  });
  await check();return projectNativePdf(raw,{originalSHA256:hash(original),artifactSHA256,lineGeometry});
 };
}
