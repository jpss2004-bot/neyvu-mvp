import {tenant,uuid} from './db';
import {BetaHttpError} from './http';
import type {SourceLibraryPage} from './source-library-types';

type Input={course?:unknown;kind?:unknown;q?:unknown;cursor?:unknown;limit?:unknown};
type Cursor={at:string;id:string;scope:string};
export function libraryInput(input:Input,account?:string){
 const course=input.course||null,kind=input.kind||null,q=typeof input.q==='string'?input.q.trim():input.q==null?'':null;
 const limit=input.limit==null?20:Number(input.limit);
 if(course!==null&&!uuid(course)||kind!==null&&(typeof kind!=='string'||!['moodle','file','note'].includes(kind))||q===null||q.length>200||q.includes('\0')||!Number.isSafeInteger(limit)||limit<1||limit>50)throw new BetaHttpError('Choose a valid material filter.');
 const scope=JSON.stringify([account||null,course,kind,q,limit]);let cursor:Cursor|null=null;
 if(input.cursor!=null&&input.cursor!==''){
  try{
   if(typeof input.cursor!=='string'||input.cursor.length>2048||!/^[A-Za-z0-9_-]+$/.test(input.cursor))throw Error();
   cursor=JSON.parse(Buffer.from(input.cursor,'base64url').toString('utf8'));
   if(!cursor||Object.keys(cursor).sort().join(',')!=='at,id,scope'||cursor.scope!==scope||!uuid(cursor.id)||typeof cursor.at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(cursor.at)||!Number.isFinite(Date.parse(cursor.at))||new Date(cursor.at).toISOString().slice(0,10)!==cursor.at.slice(0,10))throw Error();
  }catch{throw new BetaHttpError('Material filters changed. Return to the first page.');}
 }
 return {course:course as string|null,kind:kind as string|null,q:q!,limit,scope,cursor};
}

// Filter the whole tenant library before limiting metadata. The mixed bootstrap
// snapshot intentionally remains separate from this user-facing catalogue.
export async function betaSourceLibrary(user:string,input:Input={}):Promise<SourceLibraryPage>{
 const filter=libraryInput(input,user),pattern='%'+filter.q.replace(/[\\%_]/g,'\\$&')+'%';
 return tenant(user,async c=>{
  if(filter.course&&!(await c.query('SELECT 1 FROM schoolvault.courses WHERE user_id=$1 AND id=$2',[user,filter.course])).rowCount)throw new BetaHttpError('Course not found.',404);
  const result=(await c.query(`WITH filtered AS MATERIALIZED (
   SELECT s.id,s.course_id,s.title,s.kind,s.original_url,v.id AS version_id,v.observed_at,v.mime,v.bytes,
    to_char(v.observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
   FROM schoolvault.sources s JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.source_id=s.id AND v.id=s.current_version
   WHERE s.user_id=$1 AND s.kind!='ai_draft' AND ($2::uuid IS NULL OR s.course_id=$2) AND ($3::text IS NULL OR s.kind=$3)
    AND ($4::text='' OR s.title ILIKE $5 OR EXISTS (
     SELECT 1 FROM schoolvault.passages p WHERE p.user_id=$1 AND p.source_id=s.id AND p.version_id=v.id
      AND to_tsvector('english',p.body)@@websearch_to_tsquery('english',$4)
    ))
  ) SELECT (SELECT count(*) FROM filtered) AS total,coalesce((SELECT jsonb_agg(to_jsonb(listed) ORDER BY listed.observed_at DESC,listed.id DESC) FROM (
   SELECT * FROM filtered WHERE $6::timestamptz IS NULL OR (observed_at,id)<($6::timestamptz,$7::uuid)
   ORDER BY observed_at DESC,id DESC LIMIT $8
  ) listed),'[]'::jsonb) AS items`,[user,filter.course,filter.kind,filter.q,pattern,filter.cursor?.at||null,filter.cursor?.id||null,filter.limit+1])).rows[0];
  const rows=result.items,more=rows.length>filter.limit,selected=rows.slice(0,filter.limit),last=selected.at(-1);
  return {sources:selected.map(({cursor_at,...source})=>source),total:Number(result.total),limit:filter.limit,next_cursor:more?Buffer.from(JSON.stringify({at:last.cursor_at,id:last.id,scope:filter.scope})).toString('base64url'):null};
 });
}
