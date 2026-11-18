import {createHash} from 'node:crypto';

export type SavedMaterial={format:'saved-material/1';kind:'student_notes'|'ai_draft'|'observed_source';text_sha256:string};
type Source={kind:string;title:string;body:string};
// A generated file-link inventory is context for finding an original, not
// another copy of that original. Recognize the saved inventory's structure,
// rather than treating an arbitrary document with this filename as a catalogue.
export function savedSourceCatalogue(source:Source){
 const prefix=source.body.trimStart().slice(0,2000);
 return source.kind==='file'&&/\bcourse materials(?:\.md)?$/i.test(source.title)
  &&/^#\s+.+\s+[—–-]\s+course materials\b/i.test(prefix)
  &&/Local inventory refreshed:/.test(prefix)&&/Source filenames and Moodle URLs/.test(prefix)
  &&/## Downloaded files/.test(prefix);
}
// A material label can disqualify notes from establishing a course rule. It
// never verifies the author or promotes other saved text to official evidence.
// Inspect the full pinned body before retrieval can omit a notebook header.
export function savedMaterial(source:Source):SavedMaterial{
 const prefix=source.body.trimStart().slice(0,2000);
 const notebook=/^(?:#{1,4}\s*)?Class\s+Notes\b/i.test(prefix)
  &&(/\bSource:\s*https:\/\/(?:app\.|www\.)?notion\.(?:com|so)\//i.test(prefix)
   ||/\bOne running notebook\b/i.test(prefix));
 const personalTitle=/\b(?:my|personal|student)\s+(?:class\s+)?notes?\b/i.test(source.title);
 const kind=source.kind==='ai_draft'?'ai_draft':source.kind==='note'||personalTitle||notebook?'student_notes':'observed_source';
 return {format:'saved-material/1',kind,text_sha256:createHash('sha256').update(source.body).digest('hex')};
}
