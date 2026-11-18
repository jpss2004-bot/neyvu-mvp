import {originalMimes,fileExtension} from './file-types';
import {BetaHttpError} from './http';
export type DiscoveredFile={url:string;title:string};
export function inventoryURL(value:unknown){
 if(typeof value!=='string'||value.length>2048||value.includes('\\'))return null;
 try{const u=new URL(value),keys=[...u.searchParams.keys()];if(u.origin!=='https://moodle.acadiau.ca'||u.username||u.password||u.hash||!/^\/pluginfile\.php\/[1-9]\d{0,11}\/[a-z][a-z0-9_]*\/[a-z][a-z0-9_]*\/\d{1,12}\/.+/.test(u.pathname)||new Set(keys).size!==keys.length||keys.some(k=>!['forcedownload','time'].includes(k))||keys.some(k=>!/^\d{1,16}$/.test(u.searchParams.get(k)||'')))return null;const parts=u.pathname.split('/').slice(1).map(decodeURIComponent);if(parts.some(p=>!p||p==='.'||p==='..'||/[\/\\\x00-\x1f\x7f]/.test(p)))return null;u.search='';return u.href;}catch{return null;}
}
export function discoveredFiles(raw:unknown):DiscoveredFile[]{
 if(raw==null)return [];if(!Array.isArray(raw)||raw.length>200)throw new BetaHttpError('Invalid discovered file inventory');
 const out:DiscoveredFile[]=[];for(const row of raw){const url=inventoryURL(row?.url);if(!url||typeof row.title!=='string'||!row.title.trim()||row.title.length>180||/[\x00-\x1f\x7f]/.test(row.title))throw new BetaHttpError('Invalid discovered file');if(!out.some(x=>x.url===url))out.push({url,title:row.title.trim()});}return out;
}
export const supportedDiscoveredFile=(url:string)=>originalMimes.some(mime=>fileExtension(mime).test(decodeURIComponent(new URL(url).pathname.split('/').at(-1)||'')));
export function fileInventory(stored:any[],captures:any[]){
 const rows=new Map<string,any>();
 for(const s of stored.filter(s=>s.object_key||s.device_content)){const url=inventoryURL(s.original_url),key=url||s.id;rows.set(key,{title:s.title,source_id:s.id,url:url||null,...(s.device_content?{original_location:s.device_content.original_location}:{}),state:s.extraction_status==='queued'||s.extraction_status==='leased'?'reading':s.extraction_status==='failed'?'unreadable':!s.indexed?'no_text':s.extraction_truncated==='true'||!!s.pdf_reading?.visual_pages?.length||!!s.pdf_reading?.pages_without_text?.length||!!s.pdf_reading?.page_issues?.length||s.pdf_reading?.pages_read<s.pdf_reading?.total_pages||!!s.office_reading?.images_total||s.mime?.startsWith('image/')||s.mime&&s.mime!=='text/plain'&&s.mime!=='application/pdf'&&!s.office_reading? 'review':'text_available'});}
 for(const capture of captures)for(const item of discoveredFiles(capture.files))if(!rows.has(item.url))rows.set(item.url,{...item,source_id:null,state:supportedDiscoveredFile(item.url)?'not_collected':'unsupported'});
 return {files:[...rows.values()].slice(0,1000),truncated:rows.size>1000||captures.some(c=>c.files_truncated===true)};
}
