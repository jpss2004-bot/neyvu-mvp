// When a just-uploaded file is opened before the worker has read it, the panel shows the
// original (text-less) version. Extraction saves the text as a NEW version and moves
// current_version, so the open panel must look for it instead of staying pinned.
type Opened={id:string;kind:string;version_id?:string;content?:{state:string}};
type Latest={id:string;version_id?:string;content?:{state:string}}|null|undefined;

export const SOURCE_READ_POLL_MS=5000,SOURCE_READ_POLL_LIMIT=36; // about three minutes

export function awaitingReadableVersion(opened:Opened|null){
 return !!opened&&opened.kind==='file'&&!!opened.version_id&&opened.content?.state==='no_text';
}

export function adoptReadVersion(opened:Opened|null,latest:Latest){
 return !!opened&&!!latest&&latest.id===opened.id&&!!latest.version_id&&latest.version_id!==opened.version_id
  &&!!latest.content&&latest.content.state!=='no_text';
}
