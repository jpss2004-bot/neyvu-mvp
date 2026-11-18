export type ChatScope={mode:string;course_id:string|null;context:string[];context_versions:Record<string,string>};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function readChatScope(value:unknown):ChatScope|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const r=value as Record<string,unknown>,refs=r.context,pins=r.context_versions??{};
 if(!['ask','plan','study','solve','sources'].includes(r.mode as string)||!(r.course_id===null||typeof r.course_id==='string'&&uuid.test(r.course_id))||!Array.isArray(refs)||refs.length>8||new Set(refs).size!==refs.length||refs.some(id=>typeof id!=='string'||!uuid.test(id))||!pins||typeof pins!=='object'||Array.isArray(pins)||Object.entries(pins).length>8||Object.entries(pins).some(([id,v])=>!refs.includes(id)||typeof v!=='string'||!uuid.test(v)))return null;
 return {mode:r.mode as string,course_id:r.course_id as string|null,context:[...refs],context_versions:{...pins} as Record<string,string>};
}
export function chatScope(value:unknown):ChatScope{const scope=readChatScope(value);if(!scope)throw Error('Invalid course or source selection');return scope;}
export function scopeKey(scope:ChatScope){return JSON.stringify([scope.mode,scope.course_id,[...scope.context].sort(),Object.entries(scope.context_versions).sort(([a],[b])=>a.localeCompare(b))]);}
export function sameChatScope(a:ChatScope,b:ChatScope){return scopeKey(a)===scopeKey(b);}
export function pinnedScope(scope:ChatScope){return scope.context.every(id=>!!scope.context_versions[id]);}
