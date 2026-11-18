// Convert the approved Neyvu vector to platform icon formats using cached tools.
// This makes no network requests and does not alter the source logo.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const sharp=require('sharp');
const {spawnSync}=require('node:child_process');
async function main(){
 const svg=await fs.readFile(path.join(__dirname,'../../public/brand/neyvu-favicon.svg'));
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'neyvu-brand-'));
 try{
  const iconset=path.join(temporary,'Neyvu.iconset');await fs.mkdir(iconset);
  for(const size of [16,32,128,256,512])for(const scale of [1,2]){
   await sharp(svg).resize(size*scale,size*scale).png().toFile(path.join(iconset,`icon_${size}x${size}${scale===2?'@2x':''}.png`));
  }
  const result=spawnSync('/usr/bin/iconutil',['-c','icns',iconset,'-o',path.join(__dirname,'icon.icns')],{encoding:'utf8'});
  if(result.status!==0)throw Error('Mac icon conversion failed: '+result.stderr);
  const sizes=[16,32,48,256],frames=[];
  for(const size of sizes)frames.push(await sharp(svg).resize(size,size).png().toBuffer());
  const header=Buffer.alloc(6+16*frames.length);header.writeUInt16LE(1,2);header.writeUInt16LE(frames.length,4);
  let offset=header.length;
  frames.forEach((frame,index)=>{const at=6+16*index,size=sizes[index];header[at]=size===256?0:size;header[at+1]=header[at];header.writeUInt16LE(1,at+4);header.writeUInt16LE(32,at+6);header.writeUInt32LE(frame.length,at+8);header.writeUInt32LE(offset,at+12);offset+=frame.length;});
  await fs.writeFile(path.join(__dirname,'icon.ico'),Buffer.concat([header,...frames]));
  const assets=path.join(__dirname,'build/appx');await fs.mkdir(assets,{recursive:true});
  for(const [name,width,height] of [['StoreLogo.png',50,50],['Square150x150Logo.png',150,150],['Square44x44Logo.png',44,44],['Wide310x150Logo.png',310,150]]){
   const size=Math.min(width,height),logo=await sharp(svg).resize(size,size).png().toBuffer();
   await sharp({create:{width,height,channels:4,background:'#fafcfd'}}).composite([{input:logo,gravity:'center'}]).png().toFile(path.join(assets,name));
  }
  console.log('Neyvu Mac, Windows and Store icons converted from the approved vector.');
 }finally{await fs.rm(temporary,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
