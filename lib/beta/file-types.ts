export const legacySlidesMime='application/vnd.ms-powerpoint';
export const legacySlidesEnabled=()=>process.env.SCHOOL_BETA_LEGACY_PPT_ENABLED==='1';
export const wordMime='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const slidesMime='application/vnd.openxmlformats-officedocument.presentationml.presentation';
export const sheetsMime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const imageMimes=['image/png','image/jpeg','image/webp','image/heic','image/heif'];
// iPhone photos are HEIF containers: 'ftyp' at byte 4, then an image brand ImageIO decodes.
const heifBrands=['heic','heix','heim','heis','hevc','hevx','mif1','msf1'];
const heif=(bytes:Buffer)=>bytes.length>=12&&bytes.subarray(4,8).toString('latin1')==='ftyp'&&heifBrands.includes(bytes.subarray(8,12).toString('latin1'));
export const extractedMimes=['application/pdf',wordMime,slidesMime,legacySlidesMime,sheetsMime,...imageMimes];
export const originalMimes=['text/plain',...extractedMimes];
export const fileExtension=(mime:string)=>mime==='application/pdf'?/\.pdf$/i:mime==='image/png'?/\.png$/i:mime==='image/jpeg'?/\.jpe?g$/i:mime==='image/webp'?/\.webp$/i:mime==='image/heic'||mime==='image/heif'?/\.hei[cf]$/i:mime===wordMime?/\.docx$/i:mime===slidesMime?/\.pptx$/i:mime===legacySlidesMime?/\.ppt$/i:mime===sheetsMime?/\.xlsx$/i:/\.(?:txt|md|csv)$/i;
// Office files are ZIP packages; any ZIP starts with PK, so also require the package's
// own parts (stored uncompressed as names in the ZIP directory).
const officeParts:Record<string,string[]>={[wordMime]:['[Content_Types].xml','word/document.xml'],[slidesMime]:['[Content_Types].xml','ppt/presentation.xml'],[sheetsMime]:['[Content_Types].xml','xl/workbook.xml']};
export const originalSignature=(mime:string,bytes:Buffer)=>mime===legacySlidesMime?bytes.length>=512&&bytes.subarray(0,8).equals(Buffer.from('d0cf11e0a1b11ae1','hex')):mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):mime==='image/jpeg'?bytes.subarray(0,3).equals(Buffer.from([255,216,255])):mime==='image/webp'?bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP':mime==='image/heic'||mime==='image/heif'?heif(bytes):mime==='application/pdf'?bytes.subarray(0,5).toString()==='%PDF-':(mime===wordMime||mime===slidesMime||mime===sheetsMime)?bytes.subarray(0,4).equals(Buffer.from([80,75,3,4]))&&officeParts[mime].every(part=>bytes.includes(part)):mime==='text/plain';
