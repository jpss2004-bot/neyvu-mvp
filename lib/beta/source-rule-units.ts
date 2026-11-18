// Closed sentence ranges only. Physical wraps are not a semantic boundary,
// and a following qualification belongs to the rule that precedes it.
const qualification=/^(?:however|unless|except|otherwise|only|but|this|these|those|it|they|if|when|provided|subject|approval|permission|written permission|prior approval|sin embargo|a menos|excepto|solo|esto|esta|estas)\b/i;
const abbreviation=/(?:\b(?:dr|mr|mrs|ms|prof|etc|vs|no|fig|ch|sec)|\b[A-Z]|e\.g|i\.e)\.$/i;
export function closedRuleSentences(body:string){
 const ends=[...body.matchAll(/[.!?]\s+(?=[A-ZÁÉÍÓÚÑÜ])/g)].filter(m=>!qualification.test(body.slice(m.index!+m[0].length))&&!abbreviation.test(body.slice(0,m.index!+1))).map(m=>m.index!+m[0].length);
 if(/[.!?]\s*$/.test(body))ends.push(body.length);
 const ranges:{start:number;end:number;text:string}[]=[];let start=0;
 for(const end of [...new Set(ends)]){ranges.push({start,end,text:body.slice(start,end)});start=end;}
 return ranges;
}
export function aiClassroomRestrictions(body:string){
 return closedRuleSentences(body).filter(p=>/\b(?:AI|GenAI|generative AI|artificial intelligence|ChatGPT)\b/i.test(p.text)
  &&/\bin[-\s]+class\b|\bclassroom\b/i.test(p.text)
  &&/\b(?:not (?:to be used|permitted|allowed)|cannot|may not|must not|prohibit\w*|forbid\w*)\b/i.test(p.text));
}
