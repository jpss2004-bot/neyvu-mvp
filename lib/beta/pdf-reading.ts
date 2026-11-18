import {BetaHttpError} from './http';
export const pdfIssueCodes=['ocr_unavailable','formula_unverified','visual_unread','layout_unverified'] as const;
export type PdfIssueCode=typeof pdfIssueCodes[number];
export type PdfReading={method:'selectable_text'|'native_with_ocr';total_pages:number;pages_read:number;pages_without_text:number[];visual_pages?:number[];ocr_pages?:number[];page_issues?:{page:number;code:PdfIssueCode}[]};
// Optional for older workers. Never infer complete page coverage from a text
// body or accept arbitrary worker prose as a reading/understanding certificate.
export function pdfReading(value:unknown):PdfReading|null{
 if(value===undefined||value===null)return null;
 const v=value as Partial<PdfReading>;
 const total=v.total_pages,read=v.pages_read,missing=v.pages_without_text;
 if(typeof v!=='object'||Array.isArray(v)||!['selectable_text','native_with_ocr'].includes(v.method||'')||typeof total!=='number'||!Number.isSafeInteger(total)||total<1||total>1000000||typeof read!=='number'||!Number.isSafeInteger(read)||read<1||read>500||read>total||!Array.isArray(missing)||missing.length>read||missing.some((p,i,a)=>!Number.isSafeInteger(p)||p<1||p>read||i>0&&p<=a[i-1]))throw new BetaHttpError('Invalid PDF reading coverage');
 const ocr=v.ocr_pages,issues=v.page_issues;
 const visual=v.visual_pages;
 if(visual!==undefined&&(!Array.isArray(visual)||visual.length>read||visual.some((p,i,a)=>!Number.isSafeInteger(p)||p<1||p>read||i>0&&p<=a[i-1])))throw new BetaHttpError('Invalid PDF visual coverage');
 if(v.method==='native_with_ocr'&&(!Array.isArray(ocr)||!ocr.length)||ocr!==undefined&&(!Array.isArray(ocr)||v.method!=='native_with_ocr'||ocr.length>read||ocr.some((p,i,a)=>!Number.isSafeInteger(p)||p<1||p>read||missing.includes(p)||i>0&&p<=a[i-1])))throw new BetaHttpError('Invalid PDF OCR coverage');
 if(issues!==undefined&&(!Array.isArray(issues)||issues.length>2000||issues.some(p=>!p||!Number.isSafeInteger(p.page)||p.page<1||p.page>read||!pdfIssueCodes.includes(p.code))||new Set(issues.map(p=>p.page+'|'+p.code)).size!==issues.length))throw new BetaHttpError('Invalid PDF page issues');
 return {method:v.method as PdfReading['method'],total_pages:total,pages_read:read,pages_without_text:[...missing],...(visual?{visual_pages:[...visual]}:{}),...(ocr?{ocr_pages:[...ocr]}:{}),...(issues?{page_issues:issues.map(p=>({page:p.page,code:p.code}))}:{})};
}
export function partialPdf(reading:PdfReading|null|undefined){return !!reading&&(reading.pages_read<reading.total_pages||reading.pages_without_text.length>0||!!reading.visual_pages?.length||!!reading.page_issues?.length);}
export function pdfReadingLimits(reading:PdfReading|null|undefined){
 if(!reading)return [];
 const limits=[];
 if(reading.pages_without_text.length)limits.push('No selectable text was recovered from PDF '+(reading.pages_without_text.length===1?'page ':'pages ')+reading.pages_without_text.join(', ')+'. These pages may be blank, scanned or contain diagrams; check the original or use OCR.');
 if(reading.pages_read<reading.total_pages)limits.push('Only '+reading.pages_read+' of '+reading.total_pages+' PDF pages were processed. Later pages are not available in the saved text.');
 if(reading.ocr_pages?.length)limits.push('Local OCR recovered text from PDF pages '+reading.ocr_pages.join(', ')+'. This text is unreviewed; compare the original before relying on equations or layout.');
 if(reading.visual_pages?.length)limits.push('PDF pages '+reading.visual_pages.join(', ')+': visual content needs review alongside the text. OCR does not interpret diagrams.');
 const descriptions:Record<PdfIssueCode,string>={ocr_unavailable:'OCR could not recover all content',formula_unverified:'equations include unverified or undecoded regions',visual_unread:'visual content was not interpreted',layout_unverified:'table structure and reading order need review'};
 for(const code of pdfIssueCodes){const pages=[...new Set(reading.page_issues?.filter(p=>p.code===code).map(p=>p.page)||[])].sort((a,b)=>a-b);if(pages.length)limits.push('PDF pages '+pages.join(', ')+': '+descriptions[code]+'. Check the original.');}
 return limits;
}

export function pdfReaderEvidence(value:unknown,reading:PdfReading|null){
 if(value===undefined||value===null)return null;
 const v=value as {reader:string;reviewed:boolean;regions:{page:number;code:PdfIssueCode;item:string;provenance:{page_no:number;bbox:{l:number;t:number;r:number;b:number;coord_origin:string};charspan:number[]}[]}[]};
 if(!reading||typeof v!=='object'||v.reader!=='docling-2.133.0'||v.reviewed!==false||!Array.isArray(v.regions)||v.regions.length>400)throw new BetaHttpError('Invalid PDF reader evidence');
 for(const r of v.regions){
  if(!r||!Number.isSafeInteger(r.page)||r.page<1||r.page>reading.pages_read||!pdfIssueCodes.includes(r.code)||!reading.page_issues?.some(p=>p.page===r.page&&p.code===r.code)||!/^#\/(?:texts|pictures|tables)\/\d{1,6}$/.test(r.item)||!Array.isArray(r.provenance)||!r.provenance.length||r.provenance.length>4)throw new BetaHttpError('Invalid PDF region evidence');
  // Layout boxes can extend beyond the page edge (a saved lecture yielded
  // l=-0.263698). Retain the observed box rather than clamping its provenance.
  for(const p of r.provenance){if(!p||p.page_no!==r.page||!p.bbox||!['TOPLEFT','BOTTOMLEFT'].includes(p.bbox.coord_origin)||!['l','t','r','b'].every(k=>typeof p.bbox[k as 'l']==='number'&&Number.isFinite(p.bbox[k as 'l'])&&Math.abs(p.bbox[k as 'l'])<=100000)||p.bbox.l>p.bbox.r||!Array.isArray(p.charspan)||p.charspan.length!==2||p.charspan.some(n=>!Number.isSafeInteger(n)||n<0||n>1000000)||p.charspan[0]>p.charspan[1])throw new BetaHttpError('Invalid PDF region coordinates');}
 }
 return {reader:v.reader,reviewed:false,regions:v.regions.map(r=>({page:r.page,code:r.code,item:r.item,provenance:r.provenance.map(p=>({page_no:p.page_no,bbox:{l:p.bbox.l,t:p.bbox.t,r:p.bbox.r,b:p.bbox.b,coord_origin:p.bbox.coord_origin},charspan:[...p.charspan]}))}))};
}
