// Prefer a contiguous, verbatim passage from the selected immutable source.
// Never manufacture an excerpt by merging a title with unrelated instructions.
export function activityPreview(body:string,quote?:string,title?:string,max=380):string{
 const text=body.trim();
 if(!text)return '';
 const exact=quote?.trim();
 let offset=exact&&text.includes(exact)?text.indexOf(exact):-1;
 if(offset<0&&title?.trim()){
  const escaped=title.trim().replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s+');
  const match=new RegExp('(?:^|[^\\p{L}\\p{N}])('+escaped+')(?![\\p{L}\\p{N}])','iu').exec(text);
  if(match)offset=match.index+match[0].indexOf(match[1]);
 }
 if(offset<0)return ''; // An unrelated course introduction is not an activity preview.
 const lineStart=text.lastIndexOf('\n',offset-1)+1;
 const start=offset-lineStart<100?lineStart:offset;
 return (start>0?'…':'')+text.slice(start,start+max)+(text.length>start+max?'…':'');
}
