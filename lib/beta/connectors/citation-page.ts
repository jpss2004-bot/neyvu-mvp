// C9: citations open the saved original PDF at the cited page. Extracted PDF
// text is saved as "Page N\n<text>" blocks (scripts/extract_pdf.py), so the page
// of a cited excerpt is the last page header before where the excerpt occurs.
// Browsers' PDF viewers honour #page=N on inline PDFs.
const header=/(?:^|\n)Page (\d{1,5})\n/g;
export function pdfPageAt(body:string,offset:number):number|null{
 let page:number|null=null;header.lastIndex=0;let m:RegExpExecArray|null;
 while((m=header.exec(body))&&m.index<=offset)page=Number(m[1]);
 return page;
}
const squash=(s:string)=>s.replace(/\s+/g,' ').trim();
export function pdfPageForExcerpt(body:string|null|undefined,excerpt:string|null|undefined):number|null{
 if(!body||!excerpt)return null;
 const inside=/(?:^|\n)Page (\d{1,5})\n/.exec(excerpt);
 const probe=squash(excerpt.replace(/(?:^|\n)Page \d{1,5}\n/g,' ')).slice(0,80);
 if(probe.length>=12){
  // Match on whitespace-insensitive text, then map back to the original offset.
  const words=probe.split(' ').map(w=>w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
  const found=new RegExp(words.join('\\s+')).exec(body);
  if(found)return pdfPageAt(body,found.index);
 }
 return inside?Number(inside[1]):null;
}
export const pageCitationsOn=()=>process.env.NEXT_PUBLIC_NEYVU_PDF_PAGE_CITATIONS==='1'||process.env.NEYVU_PDF_PAGE_CITATIONS==='1';
export function pageFragment(body:string|null|undefined,excerpt:string|null|undefined){
 if(!pageCitationsOn())return '';
 const page=pdfPageForExcerpt(body,excerpt);return page?`#page=${page}`:'';
}
