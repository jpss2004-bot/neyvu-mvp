export type RevisionDiff={kind:'same'|'removed'|'added';text:string};
// Adapted from the collaborating feedback-workbench/core.js. Text remains
// text; the bounded LCS is a visual comparison, never a correctness judgment.
export function revisionDiff(a:string,b:string):RevisionDiff[]{
 if(a===b)return a?[{kind:'same',text:a}]:[];
 if(!a)return [{kind:'added',text:b}];if(!b)return [{kind:'removed',text:a}];
 const aa=a.match(/\s+|\S+/g)||[],bb=b.match(/\s+|\S+/g)||[];
 if(aa.length*bb.length>160000)return [{kind:'removed',text:a},{kind:'added',text:b}];
 const grid=Array.from({length:aa.length+1},()=>new Uint16Array(bb.length+1));
 for(let i=aa.length-1;i>=0;i--)for(let j=bb.length-1;j>=0;j--)grid[i][j]=aa[i]===bb[j]?1+grid[i+1][j+1]:Math.max(grid[i+1][j],grid[i][j+1]);
 const out:RevisionDiff[]=[];let i=0,j=0;
 const push=(kind:RevisionDiff['kind'],value:string)=>{if(out.at(-1)?.kind===kind)out[out.length-1].text+=value;else out.push({kind,text:value});};
 while(i<aa.length||j<bb.length){
  if(i<aa.length&&j<bb.length&&aa[i]===bb[j]){push('same',aa[i++]);j++;}
  else if(i<aa.length&&(j===bb.length||grid[i+1][j]>=grid[i][j+1]))push('removed',aa[i++]);
  else push('added',bb[j++]);
 }
 return out;
}
export function revisionComparison(text:string){
 const lines=text.split('\n');let fence:string|null=null;
 const label=(s:string)=>s.trim().replace(/^\*\*|\*\*$/g,'');
 for(let i=0;i<lines.length;i++){
  const code=lines[i].trim().match(/^(`{3,}|~{3,})/);
  if(code){if(!fence)fence=code[1][0];else if(fence===code[1][0])fence=null;continue;}
  if(fence||!['Your current wording:','Tu redacción actual:','Redacción actual:','Tu texto actual:','Texto actual:'].includes(label(lines[i])))continue;
  let j=i+1;while(j<lines.length&&!lines[j].trim())j++;
  const before:string[]=[];while(lines[j]?.startsWith('> ')){before.push(lines[j].slice(2));j++;}
  while(j<lines.length&&!lines[j].trim())j++;
  if(!['Suggested revision:','Revisión sugerida:','Revisión propuesta:','Versión sugerida:','Redacción sugerida:'].includes(label(lines[j]||'')))continue;j++;
  while(j<lines.length&&!lines[j].trim())j++;
  const after:string[]=[];while(lines[j]?.startsWith('> ')){after.push(lines[j].slice(2));j++;}
  const a=before.join('\n'),b=after.join('\n');
  if(!a||!b||a.length>1600||b.length>1600)continue;
  return {prefix:lines.slice(0,i).join('\n'),before:a,after:b,suffix:lines.slice(j).join('\n')};
 }
 return null;
}
