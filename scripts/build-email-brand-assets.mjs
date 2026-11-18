// Email clients do not reliably show SVG, so emails use a PNG logo plate rendered from the
// production wordmark with the project's Sharp dependency. The white plate keeps the dark
// wordmark readable when a mail client forces dark mode. Shown at 150x44, rendered at 2x.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
const source=fs.readFileSync(path.join(root,'public/brand/neyvu-wordmark-light.svg'),'utf8');
const box=source.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);if(!box)throw Error('Wordmark viewBox missing');
const [w,h]=[Number(box[1]),Number(box[2])],inner=source.replace(/^[\s\S]*?<svg[^>]*>/,'').replace(/<\/svg>\s*$/,'').replace(/<title>[\s\S]*?<\/title>/,'');
const width=300,height=88,mark=52,scale=mark/h,x=(width-w*scale)/2,y=(height-mark)/2;
const plate=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" rx="18" fill="#ffffff"/><g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(5)})">${inner}</g></svg>`;
const out=path.join(root,'public/brand/email/neyvu-email-logo.png');
fs.mkdirSync(path.dirname(out),{recursive:true});
await sharp(Buffer.from(plate)).png({compressionLevel:9}).toFile(out);
console.log(JSON.stringify({written:path.relative(root,out),width,height}));
