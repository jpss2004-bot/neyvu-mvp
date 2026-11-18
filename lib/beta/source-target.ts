// A retrieval hit does not identify the document meant by "this file".
// Keep this rule in parity with continuity_scope.missing_source_target.
export function missingSourceTarget(input:{question?:string;context?:unknown;history?:Array<{role?:string;text?:string}>}){
 const question=input.question||'';
 if(Array.isArray(input.context)&&input.context.length)return false;
 if((input.history||[]).slice(0,-1).some(row=>row.role==='user'&&row.text?.trim()))return false;
 return /\b(?:this|the) (?:file|chapter|system|document|pdf)\b|\b(?:este|ese|el) (?:archivo|documento|cap[ií]tulo|sistema|pdf)\b/i.test(question)
  &&!/\d|\[|=|true or false|if\b.*\bthen|linear system|augmented matrix|verdadero o falso|sistema lineal|matriz aumentada/i.test(question);
}

// Match the worker's existing missing-answer precheck before mandatory source
// reading. Search hits cannot supply the student's answer to be checked.
export function missingStudentAnswer(input:{question?:string;context?:unknown;history?:Array<{role?:string;text?:string}>;student_context?:{work?:unknown}|null}){
 const q=input.question||'';
 if(Array.isArray(input.context)&&input.context.length)return false;
 if((input.history||[]).slice(0,-1).some(row=>row.role==='user'&&row.text?.trim()))return false;
 if(Array.isArray(input.student_context?.work)&&input.student_context.work.length)return false;
 return /\b(?:check|grade|review)\b.*\bmy\b.*\b(?:answer|draft|response|solution)\b|\bmy\b.*\banswer\b.*\b(?:right|correct)\b/i.test(q)
  &&!/\n|=|\[\[|my (?:answer|solution)\s*(?:is|:)/i.test(q);
}
