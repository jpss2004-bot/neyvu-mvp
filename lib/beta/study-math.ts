import rehypeKatex from 'rehype-katex';

export function studyMath(){
 const render=rehypeKatex({trust:false,strict:'error'});
 return (...args:Parameters<typeof render>)=>{
  const [tree,file]=args;render(tree,file);
  // The plugin can recover an unsupported command as red text inside an
  // otherwise valid .katex span. Keep the original error visible for preflight.
  if(file.messages.some(message=>message.source==='rehype-katex')){
   tree.children.unshift({type:'element',tagName:'p',properties:{className:['study-math-render-error']},children:[{type:'text',value:'An equation could not render correctly. Ask for corrected notation before printing this answer.'}]});
  }
 };
}
