type Node={type:string;value?:string;url?:string;children?:Node[];data?:{hProperties:{className:string}}};
// Transform only Markdown prose text. Citation-like syntax in equations, code
// and existing links must retain its original meaning.
export function studyCitations(options?:{hrefs:string[]}){
 return (tree:Node)=>{
  function walk(node:Node){
   if(!node.children||['link','image','code','inlineCode','math','inlineMath'].includes(node.type))return;
   node.children=node.children.flatMap(child=>{
    if(child.type!=='text'||!child.value){walk(child);return [child];}
    const pieces:Node[]=[];let cursor=0;
    for(const match of child.value.matchAll(/\[(\d+)\]/g)){
     const href=options?.hrefs?options.hrefs[Number(match[1])-1]:'#study-source-'+match[1];if(!href)continue;
     const start=match.index!;if(start>cursor)pieces.push({type:'text',value:child.value.slice(cursor,start)});
     pieces.push({type:'link',url:href,children:[{type:'text',value:'['+match[1]+']'}]});cursor=start+match[0].length;
    }
    if(!pieces.length)return [child];
    if(cursor<child.value.length)pieces.push({type:'text',value:child.value.slice(cursor)});
    return pieces;
   });
  }
  walk(tree);
 };
}

// Keep an exact engine's row operation beside its resulting matrix when a
// worksheet paginates. This changes layout only; the original words stay intact.
export function studyWorkedSteps(){
 return (tree:Node)=>{
  const onlyMath=(node:Node)=>node.type==='paragraph'&&node.children?.length===1&&node.children[0].type==='inlineMath'?node.children[0].value:undefined;
  function walk(node:Node){
   if(!node.children)return;
   const grouped:Node[]=[];
   for(let index=0;index<node.children.length;index++){
    const current=node.children[index],next=node.children[index+1],operation=onlyMath(current),matrix=next&&onlyMath(next);
    if(operation&&/^R_\{\d+\} \\(?:leftarrow|leftrightarrow) /.test(operation)&&matrix?.startsWith('\\begin{bmatrix}')){
     grouped.push({type:'blockquote',data:{hProperties:{className:'study-row-step'}},children:[current,next]});index++;
    }else{walk(current);grouped.push(current);}
   }
   node.children=grouped;
  }
  walk(tree);
 };
}
