const materials='(?:courses?|materials?|files?|sources?|pdfs?|content|collection|cursos?|materiales|archivos?|fuentes?|contenido|recopilacion)';
const coverageRequest=new RegExp('\\b(?:(?:show|list|check|audit|review|tell)(?: me)?|is|are|which|what|(?:explain|summari[sz]e)\\s+(?:which|what)|que|cuales|hay|muestra|lista|revisa|comprueba)\\b[^.!?;\\n]{0,100}\\b'+materials+'\\b','i');
const studyRequest=/\b(?:plan (?:my|our|the|this|next) (?:week|day)|focus on (?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)|prepare me|help me (?:prepare|study|understand)|explain|summari[sz]e|synthesi[sz]e|compare|teach me|walk me through|solve|preparame|ayudame a (?:preparar|estudiar|entender)|explica|explicame|resume|sintetiza|compara|ensename|resuelve)\b/i;

/** A missing-source caveat must not replace the student's primary study task. */
export function collectionQuestion(question:string){
 const text=question.normalize('NFKD').replace(/\p{M}/gu,'');
 if(/\bwhat can (?:you|the assistant) (?:actually )?read\b/i.test(text)&&/\b(?:vault|saved|course|materials?)\b/i.test(text))return true;
 if(!new RegExp('\\b'+materials+'\\b','i').test(text)
  ||! /\b(?:missing|unreadable|not (?:collected|captured|readable)|collection gaps|complete coverage|everything.{0,35}(?:captured|readable)|all.{0,35}(?:captured|readable)|faltan?|faltantes?|ilegibles?|sin (?:recopilar|capturar|leer))\b/i.test(text)
  ||/\b(?:equation|eigenvector|matrix|variable|coefficient)\b/i.test(text))return false;
 const study=text.search(studyRequest),coverage=text.search(coverageRequest);
 // Explicit coverage asked first still wins ("check missing files, then prepare
 // me"). A later caveat stays auxiliary to preparation or explanation.
 return study<0||coverage>=0&&coverage<=study;
}
