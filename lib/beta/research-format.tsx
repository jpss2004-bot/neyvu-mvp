import React from 'react';
import Markdown from 'react-markdown';
import CSL from 'citeproc';
import assets from './csl-assets.json';
import {BetaHttpError} from './http';
import {missingReferenceFields,referenceMetadata} from './citation-metadata';
import {sourceReferenceHref} from './source-reference';
import type {ResearchReference,CitationStyle,FormattedResearch} from './research-types';

type Node={type:string;value?:string;url?:string;children?:Node[]};
const escapeHtml=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
// Markdown returns a synchronous React tree. Export only a small set of Word-
// friendly structural tags; never serialize raw HTML, event props or links.
function serialize(node:React.ReactNode):string{
 if(node===null||node===undefined||typeof node==='boolean')return '';
 if(typeof node==='string'||typeof node==='number')return escapeHtml(String(node));
 if(Array.isArray(node))return node.map(serialize).join('');
 if(!React.isValidElement(node))return '';
 const props=node.props as {children?:React.ReactNode;start?:number;alt?:string};
 const children=serialize(props.children),tag=typeof node.type==='string'?node.type:'';
 if(tag==='img')return escapeHtml('[Image omitted'+(props.alt?': '+props.alt:'')+'. Open the saved source to inspect it.]');
 if(['br','hr'].includes(tag))return '<'+tag+'/>';
 if(!['p','h1','h2','h3','h4','h5','h6','strong','em','ul','ol','li','blockquote','pre','code','table','thead','tbody','tr','td','th','del'].includes(tag))return children;
 const start=tag==='ol'&&Number.isSafeInteger(props.start)?' start="'+props.start+'"':tag==='p'?' style="font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:150%;margin:0 0 10pt"':'';
 return '<'+tag+start+'>'+children+'</'+tag+'>';
}
function renderMarkdown(answer:string,plugin:ReturnType<typeof citations>){return serialize(Markdown({children:answer,skipHtml:true,remarkPlugins:[plugin]}));}

function citations(refs:ResearchReference[],replace:(n:number)=>string){return ()=> (tree:Node)=>{
 function walk(node:Node){
  if(node.type==='link'){
   const label=node.children?.map(x=>x.value||'').join('')||'',m=label.match(/^\[(\d+)\]$/);
   if(m){const n=+m[1],ref=refs.find(x=>x.number===n);if(ref?.id&&node.url===sourceReferenceHref(ref as {id:string;version_id?:string})){node.type='text';node.value=replace(n);delete node.children;delete node.url;}}
   return;
  }
  if(['code','inlineCode','image'].includes(node.type))return;
  if(node.type==='text'&&node.value){
   // Preserve math delimiters and inline literal formulas as well as code.
   const pieces=node.value.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]*?\$)/g);
   node.value=pieces.map((part,i)=>i%2?part:part.replace(/([.!?])\s+\[(\d+)\](?=\s|$)/g,' [$2]$1').replace(/\[(\d+)\]/g,(_,n)=>replace(+n))).join('');
  }
  node.children?.forEach(walk);
 }walk(tree);
};}
export function htmlToPlainText(html:string){return html.replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/(?:p|div|h[1-6]|li|blockquote|pre)>/gi,'\n\n').replace(/<li(?:\s[^>]*)?>/gi,'• ').replace(/<[^>]*>/g,'').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n)).replace(/&#x([a-f0-9]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&nbsp;/g,' ').replace(/&quot;/g,'"').replace(/&#x27;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/\n{3,}/g,'\n\n').trim();}
function authorNames(value:string){return value.split(';').map(x=>x.trim()).filter(Boolean).map(name=>{const parts=name.split(',').map(x=>x.trim());return parts.length===2?{family:parts[0],given:parts[1]}:{literal:name};});}
export function formatResearch(answer:string,refs:ResearchReference[],style:CitationStyle):FormattedResearch{
 if(answer.length>100000||refs.length>30)throw new BetaHttpError('This answer is too large for a citation export.');
 const used:number[]=[];
 renderMarkdown(answer,citations(refs,n=>{if(!refs.some(r=>r.number===n))throw new BetaHttpError('Citation ['+n+'] has no saved source. Review the answer before exporting.');if(!used.includes(n))used.push(n);return '['+n+']';}));
 const selected=used.map(n=>refs.find(r=>r.number===n)!);
 const records=new Map(selected.map(r=>{
  const m=referenceMetadata(r.metadata);
  return [String(r.number),{id:String(r.number),type:m.type,title:m.title,...(m.author?{author:authorNames(m.author)}:{}),...(m.year?{issued:{'date-parts':[[+m.year]]}}:{}),...(m.container?{'container-title':m.container}:{}),...(m.publisher?{publisher:m.publisher}:{}),...(m.volume?{volume:m.volume}:{}),...(m.issue?{issue:m.issue}:{}),...(m.pages?{page:m.pages}:{}),...(m.doi?{DOI:m.doi}:{}),...(m.url?{URL:m.url}:{})}];
 }));
 const engine=new CSL.Engine({retrieveLocale:()=>assets.locale,retrieveItem:(id:string)=>records.get(id)},assets[style],'en-US');
 engine.setOutputFormat('html');engine.updateItems([...records.keys()]);
 const formatted=new Map(selected.map(r=>[r.number,htmlToPlainText(engine.makeCitationCluster([{id:String(r.number)}]))]));
 const body=renderMarkdown(answer,citations(refs,n=>formatted.get(n)||'['+n+']'));
 const bibliography=selected.length?engine.makeBibliography():null;
 const bib=bibliography?bibliography[1].map((entry:string)=>entry.replace('<div class="csl-entry">','<p style="font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:200%;margin:0 0 10pt 36pt;text-indent:-36pt">').replace(/<\/div>\s*$/,'</p>')).join(''):'';
 const referenceRows=bibliography?bibliography[1].map((html:string,i:number)=>({number:Number(bibliography[0].entry_ids[i][0]),text:htmlToPlainText(html)})):[];
 const warnings=selected.flatMap(r=>[...(missingReferenceFields(r.metadata).length?['Draft reference ['+r.number+']: missing '+missingReferenceFields(r.metadata).join(', ')+'.']:[]),...(r.state!=='available'?['Source ['+r.number+'] '+(r.state==='changed'?'has a newer saved version; this answer keeps the cited version.':'is unavailable; its supporting passage cannot currently be checked.')]:[])]);
 if(/\$[^$]+\$/.test(answer))warnings.push('Mathematical notation is copied as text. Check equation formatting in your document.');
 if(!selected.length)warnings.push('This answer has no numbered source citations. No references were invented.');
 const notes=warnings.length?'<section><h2>Reference checks</h2><ul>'+warnings.map(w=>'<li>'+escapeHtml(w)+'</li>').join('')+'</ul></section>':'';
 const html='<html><head><meta charset="utf-8"/></head><body><article style="font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.5">'+body+(bib?'<h2>References</h2>'+bib:'')+notes+'</article></body></html>';
 return {html,text:htmlToPlainText(html),warnings,references:referenceRows};
}
