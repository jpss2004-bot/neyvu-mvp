// Use the original student request, never source text or a model translation.
// Ordinary source selections remain anchors for course retrieval.
export function selectedSourcesOnly(question:string){
 const text=question.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const target='(?:(?:this|these|the|my)\\s+)?(?:(?:selected|saved|attached|chosen)\\s+){1,3}(?:syllab(?:us|i)|sources?|documents?|files?|passages?|notes?|materials?)';
 const direct='(?:this|these)\\s+(?:saved\\s+)?(?:syllab(?:us|i)|sources?|documents?|files?|passages?|notes?)';
 if(/\b(?:not|isn.t|is not)\s+(?:just|only)\b|\bno\s+solo\b/.test(text))return false;
 return new RegExp('\\b(?:only|solely|exclusively)\\s+(?:from\\s+|on\\s+)?(?:'+target+'|'+direct+')\\b').test(text)
  ||new RegExp('\\b(?:'+target+'|'+direct+')\\s+only\\b').test(text)
  ||/\b(?:solo|solamente|unicamente|exclusivamente)\s+(?:(?:con|en|de|usa|usar|utiliza|utilizando)\s+)?(?:el|la|los|las|este|esta|estos|estas)\s+(?:(?:programa|documento|archivo|fuente|nota|material|texto)s?\s+(?:(?:guardad|adjuntad)[oa]s?\s+)?seleccionad[oa]s?|(?:documento|fuente|programa|texto)s?\s+adjunt[oa]s?)\b/.test(text);
}
