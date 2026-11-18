// Structure-aware chunking (workstream B5). Replaces the fixed 4,000-character
// slices every 3,500 characters. Chunks are cut on headings, pages, slides and
// table rows; a deadline line or a table row is never split. Each chunk carries
// a context header (course, document title, section) that is used for
// embedding and reranking; the stored passage body stays the original text so
// excerpts, hashes and citations still quote the source verbatim.
//
// Chunker v1 is selected by NEYVU_CHUNKER=structure (default: legacy fixed
// slices, unchanged behaviour). Pure functions; no I/O.

export const chunkerVersion='structure-v1';
export const legacyChunkerVersion='fixed-4000-3500';

export type ChunkKind='heading'|'page'|'slide'|'table'|'text';
export type Chunk={
 ordinal:number;
 body:string;           // verbatim source text for this chunk
 section:string|null;   // nearest heading / page / slide label
 kind:ChunkKind;
 start:number;end:number; // character offsets in the version body
 header:string;          // "Course: …\nDocument: …\nSection: …" (not part of body)
};
export type ChunkContext={title?:string|null;course?:string|null};

// NEYVU_CHUNK_TARGET (characters, default 1600; max is 1.5x) is a tuning knob for
// evaluation only; chunkerVersion stays structure-v1 because offsets and kinds are unchanged.
const envTarget=Number(process.env.NEYVU_CHUNK_TARGET||1600);
const target=Number.isInteger(envTarget)&&envTarget>=400&&envTarget<=4000?envTarget:1600,max=Math.round(target*1.5);

// A unit marker starts a new structural unit. Extractor formats:
// "Page 3" (PDF), "Slide 4"/"Slide 4 notes" (pptx), "--- Page 2 ---" (fixtures),
// markdown headings and "Sheet: name" style labels.
const pageLine=/^(?:-{2,}\s*)?(Page|Slide|Sheet)\s+(\d{1,5})(\s+notes)?(?:\s*-{2,})?\s*$/i;
const headingLine=/^(#{1,6})\s+(\S.{0,200})$/;
const tableLine=/^\s*\|.*\|\s*$/;

type Block={text:string;start:number;end:number;section:string|null;kind:ChunkKind;hard:boolean};

// Splits a body into structural blocks. Every character belongs to exactly one block.
export function structuralBlocks(body:string):Block[]{
 const blocks:Block[]=[];
 let section:string|null=null,kind:ChunkKind='text';
 let cur:Block|null=null;
 const lines=body.match(/[^\n]*\n|[^\n]+$/g)||[];
 let offset=0;
 const open=(hard:boolean,k:ChunkKind,start:number)=>{if(cur)blocks.push(cur);cur={text:'',start,end:start,section,kind:k,hard};};
 for(const raw of lines){
  const line=raw.replace(/\n$/,'');
  const page=line.match(pageLine),heading=line.match(headingLine),table=tableLine.test(line);
  if(page){section=`${page[1][0].toUpperCase()}${page[1].slice(1).toLowerCase()} ${page[2]}${page[3]?' notes':''}`;kind=page[1].toLowerCase()==='slide'?'slide':'page';open(true,kind,offset);}
  else if(heading){section=heading[2].trim();kind='heading';open(true,'heading',offset);}
  else if(table&&cur?.kind!=='table'){open(false,'table',offset);}
  else if(!table&&cur?.kind==='table'){open(false,kind,offset);}
  else if(!cur)open(false,kind,offset);
  cur!.text+=raw;cur!.end=offset+raw.length;offset+=raw.length;
 }
 if(cur)blocks.push(cur);
 return blocks.filter(b=>b.text.length);
}

// Cuts an oversized block on paragraph, then line, then sentence boundaries.
// Table blocks are cut only between rows, and the header row is repeated in the
// context header (never inside the body), so every row stays whole.
function splitBlock(b:Block):Block[]{
 if(b.text.length<=max)return [b];
 const out:Block[]=[];let rest=b.text,start=b.start;
 const boundary=(s:string)=>{
  const head=s.slice(0,target+1);
  for(const sep of b.kind==='table'?['\n']:['\n\n','\n','. ','? ','! ','; ']){const i=head.lastIndexOf(sep);if(i>=target/3)return i+sep.length;}
  // A table row or a line longer than the target: take the whole line up to max.
  const nl=s.indexOf('\n');if(nl>0&&nl<max)return nl+1;
  const sp=s.slice(0,max).lastIndexOf(' ');return sp>target/3?sp+1:max;
 };
 while(rest.length>max){const cut=boundary(rest);out.push({...b,text:rest.slice(0,cut),start,end:start+cut,hard:out.length?false:b.hard});start+=cut;rest=rest.slice(cut);}
 if(rest.length)out.push({...b,text:rest,start,end:start+rest.length,hard:false});
 return out;
}

function header(ctx:ChunkContext,section:string|null,tableHead:string|null){
 return [ctx.course?`Course: ${ctx.course}`:null,ctx.title?`Document: ${ctx.title}`:null,section?`Section: ${section}`:null,tableHead?`Table columns: ${tableHead}`:null].filter(Boolean).join('\n');
}

// Groups blocks into chunks of roughly `target` characters without crossing a
// page/slide/heading boundary unless the previous chunk is tiny.
export function chunkDocument(body:string,ctx:ChunkContext={}):Chunk[]{
 if(!body)return [];
 // A table block starts with its header row; split pieces inherit it.
 const blocks=structuralBlocks(body).flatMap(b=>splitBlock(b).map(piece=>({...piece,tableHead:b.kind==='table'?b.text.split('\n')[0].trim():null})));
 const chunks:(Chunk&{tableHead?:string|null})[]=[];
 for(const b of blocks){
  const last=chunks[chunks.length-1];
  const tiny=last&&last.body.trim().length<200;
  const joinable=last&&last.body.length+b.text.length<=target&&(!b.hard||tiny)&&(b.kind!=='slide'&&b.kind!=='page'||tiny);
  if(joinable){
   // A chunk that is only a heading line takes the next section's label; one
   // with its own text keeps it and adds the next ("Late work · Textbook").
   const onlyHeading=!last.body.replace(/^[^\n]*\n?/,'').trim();
   if(b.hard&&b.section&&b.section!==last.section)last.section=!last.section||onlyHeading?b.section:`${last.section} · ${b.section}`;
   if(b.hard&&onlyHeading)last.kind=b.kind;
   last.body+=b.text;last.end=b.end;continue;
  }
  chunks.push({ordinal:chunks.length,body:b.text,section:b.section,kind:b.kind,start:b.start,end:b.end,header:'',tableHead:b.tableHead});
 }
 return chunks.map(({tableHead,...c})=>({...c,header:header(ctx,c.section,c.kind==='table'&&tableHead&&!c.body.includes(tableHead)?tableHead:null)}));
}

// The legacy chunker, kept verbatim so NEYVU_CHUNKER unset changes nothing.
export function legacyChunks(body:string):Chunk[]{
 const out:Chunk[]=[];
 for(let offset=0,ordinal=0;offset<body.length;offset+=3500,ordinal++)out.push({ordinal,body:body.slice(offset,offset+4000),section:null,kind:'text',start:offset,end:Math.min(body.length,offset+4000),header:''});
 return out;
}

export function structureChunkingEnabled(){return process.env.NEYVU_CHUNKER==='structure';}

export function chunksFor(body:string,ctx:ChunkContext={}){return structureChunkingEnabled()?chunkDocument(body,ctx):legacyChunks(body);}

// The text an embedding / reranker sees: context header then the verbatim body.
export function embeddingText(header:string|null|undefined,body:string){return header?header+'\n\n'+body:body;}
