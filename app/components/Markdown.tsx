'use client';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import {safeLink} from '../../lib/policy';
function remarkCitations({count}:{count:number}) {
 return (tree:any)=>{
  function walk(node:any){
   if(!node.children||['link','linkReference','code','inlineCode','math','inlineMath'].includes(node.type))return;
   node.children=node.children.flatMap((child:any)=>{
    if(child.type!=='text'){walk(child);return [child];}
    const parts:any[]=[];let offset=0;
    for(const match of child.value.matchAll(/\[(\d+)\]/g)){
     const number=Number(match[1]);if(number<1||number>count)continue;
     if(match.index>offset)parts.push({type:'text',value:child.value.slice(offset,match.index)});
     parts.push({type:'link',url:'#school-source-'+number,children:[{type:'text',value:match[0]}]});offset=match.index+match[0].length;
    }
    if(offset<child.value.length)parts.push({type:'text',value:child.value.slice(offset)});
    return parts.length?parts:[child];
   });
  }walk(tree);
 };
}
export default function Markdown({text,citationCount=0,onCitation}:{text:string;citationCount?:number;onCitation?:(number:number)=>void}){
 const normalized=text.replace(/\\\[([\s\S]*?)\\\]/g,(_m,v)=>'$$'+v+'$$').replace(/\\\(([\s\S]*?)\\\)/g,(_m,v)=>'$'+v+'$');
 return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkMath,...(onCitation?[[remarkCitations,{count:citationCount}] as any]:[])]} rehypePlugins={[[rehypeKatex,{throwOnError:false,strict:false}]]} components={{a:({href,children})=>{
  const citation=/^#school-source-(\d+)$/.exec(href||'');
  if(citation&&onCitation)return <button type="button" className="inline-source" aria-label={'View source '+citation[1]} onClick={()=>onCitation(Number(citation[1]))}>{children}</button>;
  return href&&safeLink(href)?<a href={safeLink(href)} target="_blank" rel="noopener noreferrer">{children}</a>:<span>{children}</span>;
 },img:({alt})=><span>[Image: {alt}]</span>}}>{normalized}</ReactMarkdown></div>;
}
