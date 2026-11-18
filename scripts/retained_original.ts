// A reuse decision is about retained bytes and a pinned expected digest, never a
// claim that iCloud/Moodle was freshly read. The caller still hashes the bytes.
export function retainedOriginal(entry:any,version:any,relative:string,expected:string){
 if(!entry||!version||!/^[a-f0-9]{64}$/.test(expected)||entry.original_path!==relative||entry.original_sha256!==expected||entry.id!==version.source_id||entry.version_id!==version.id||version.sha256!==expected||!/^[a-f0-9-]{36}$/.test(version.object_key||'')||!Number.isSafeInteger(Number(version.bytes))||Number(version.bytes)<=0||Number(version.bytes)>300*1024**2||Number(entry.original_bytes)!==Number(version.bytes))return null;
 return {object_key:version.object_key,source_id:version.source_id,version_id:version.id,sha256:expected,bytes:Number(version.bytes)};
}
