// Generic study/navigation vocabulary for retrieval and deterministic intent.
// This is query expansion, never a translation of source evidence or user data.
// Course IDs, numbers, dates and the stored question remain unchanged.
const vocabulary:[RegExp,string][]=[
 [/\b(?:qu[eé] tengo que (?:hacer|entregar|preparar)|qu[eé] necesito hacer|qu[eé] me falta|qu[eé] me toca|mis pendientes)\b/gi,'what work do I need to do'],
 [/\b(?:esta semana)\b/gi,'this week'],[/\b(?:pr[oó]xima semana)\b/gi,'next week'],[/\bhoy\b/gi,'today'],[/\bma[nñ]ana\b/gi,'tomorrow'],
 [/\b(?:cu[aá]ndo|para cu[aá]ndo)\b/gi,'when'],[/\b(?:fecha de entrega|fechas de entrega|plazo)\b/gi,'due deadline'],
 [/\b(?:entregu[eé]|ya entregado)\b/gi,'submitted'],[/\b(?:entregar|enviar)\b/gi,'submit'],
 [/\b(?:tareas?|trabajos?)\b/gi,'assignment work'],[/\b(?:ex[aá]menes|examen)\b/gi,'exam test'],[/\b(?:pruebas?|cuestionarios?)\b/gi,'quiz'],
 [/\blaboratorios?\b/gi,'lab laboratory'],[/\b(?:trabajo en clase)\b/gi,'in-class work'],[/\b(?:lecturas?)\b/gi,'reading'],
 [/\b(?:calificaciones?|notas finales)\b/gi,'grades'],[/\b(?:horas de oficina|horario de asesor[ií]a)\b/gi,'office hours'],
 [/\b(?:anuncios?|avisos?)\b/gi,'announcement'],[/\b(?:actualizado|actualizaci[oó]n|recopilaci[oó]n)\b/gi,'collection refresh'],
 [/\b(?:notas|apuntes)\b/gi,'notes'],[/\b(?:programa del curso|temario)\b/gi,'syllabus outline'],[/\b(?:instrucciones|requisitos)\b/gi,'instructions requirements'],
 [/\b(?:valores propios|autovalores)\b/gi,'eigenvalues'],[/\b(?:vectores propios|autovectores)\b/gi,'eigenvectors'],
 [/\b(?:matriz|matrices)\b/gi,'matrix matrices'],[/\bdeterminante\b/gi,'determinant'],[/\bsistema de ecuaciones\b/gi,'system of equations'],
 [/\b(?:escribe|redacta)\b/gi,'write'],[/\b(?:completa|haz)\b/gi,'complete'],[/\b(?:por m[ií]|para m[ií])\b/gi,'for me'],[/\b(?:reflexi[oó]n|reflexiones)\b/gi,'reflection'],[/\bensayos?\b/gi,'essay'],
 [/\b(?:calcula|calcular)\b/gi,'calculate'],[/\b(?:resuelve|resolver)\b/gi,'solve'],[/\b(?:explica|expl[ií]came|explicar)\b/gi,'explain'],
 [/\b(?:integridad acad[eé]mica)\b/gi,'academic integrity'],[/\b(?:inteligencia artificial)\b/gi,'artificial intelligence'],
];
const spanishQuestion=/[áéíóúñ¿¡]|\b(?:explica|calcula|resuelve|escribe|redacta|completa|haz|tareas?|trabajos?|examen|laboratorio|apuntes|valores propios|vectores propios|hoy|esta semana|entregar|notas|avisos?|requisitos|temario)\b/i;
export function questionForIntent(question:string){if(!spanishQuestion.test(question))return question;return vocabulary.reduce((copy,[pattern,english])=>copy.replace(pattern,english),question);}
export function bilingualSearchQuestion(question:string){const expanded=questionForIntent(question);return expanded===question?question:question+' '+expanded;}

export function retrievalLanguages(prepared:string,original:string){
 if(prepared===original)return prepared;
 if(prepared.length+original.length+1<=3000)return prepared+' '+original;
 const first=Math.min(prepared.length,1499),second=Math.min(original.length,2999-first);
 return prepared.slice(0,2999-second)+' '+original.slice(0,second);
}
