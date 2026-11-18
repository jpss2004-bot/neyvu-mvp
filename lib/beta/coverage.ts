import {fileInventory} from './file-inventory';
import type {PoolClient} from 'pg';
import {classifyMoodleContent,contentCategories,type CourseReadiness} from './moodle-content';
import {partialPdf} from './pdf-reading';
// Counts current owned content only. Readable/indexed text is not a claim of
// AI understanding; a client-observed page is not a live Moodle receipt.
export async function courseCoverage(c:PoolClient,user:string){
 const courses=(await c.query(`
 SELECT c.id AS course_id,c.title AS course_title,c.moodle_id,
 (SELECT count(*)::int FROM schoolvault.sources s WHERE s.user_id=c.user_id AND s.course_id=c.id AND s.kind='moodle') AS captured_pages,
 (SELECT count(*)::int FROM schoolvault.notes n WHERE n.user_id=c.user_id AND n.course_id=c.id) AS notes,
 (SELECT count(*)::int FROM schoolvault.tasks t WHERE t.user_id=c.user_id AND t.course_id=c.id AND coalesce(t.evidence->>'active','true')!='false' AND (t.evidence->>'due_at' IS NOT NULL OR t.evidence->>'due_date' IS NOT NULL)) AS dated_tasks,
 (SELECT count(*)::int FROM schoolvault.tasks t WHERE t.user_id=c.user_id AND t.course_id=c.id AND coalesce(t.evidence->>'active','true')!='false' AND t.evidence->>'confirmation'='candidate') AS work_candidates,
 (SELECT count(*)::int FROM schoolvault.tasks t WHERE t.user_id=c.user_id AND t.course_id=c.id AND coalesce(t.evidence->>'active','true')!='false' AND t.evidence->>'due_at' IS NULL AND t.evidence->>'due_date' IS NULL) AS undated_work,
 (SELECT max(o.captured_at) FROM schoolvault.moodle_observations o JOIN schoolvault.sources s ON s.user_id=o.user_id AND s.id=o.source_id WHERE s.user_id=c.user_id AND s.course_id=c.id) AS last_capture,
 (SELECT coalesce(sum(jsonb_array_length(o.coverage->'issues')),0)::int FROM schoolvault.moodle_observations o JOIN schoolvault.sources s ON s.user_id=o.user_id AND s.id=o.source_id WHERE s.user_id=c.user_id AND s.course_id=c.id) AS capture_issues
 FROM schoolvault.courses c WHERE c.user_id=$1 ORDER BY c.code`,[user])).rows;
 const sources=(await c.query(`SELECT s.id,s.course_id,s.kind,s.title,s.original_url,v.mime,v.object_key,v.body,
 EXISTS(SELECT 1 FROM schoolvault.passages p WHERE p.user_id=s.user_id AND p.source_id=s.id AND p.version_id=v.id AND length(trim(p.body))>0) AS indexed,
 extraction.status AS extraction_status,extraction.result->>'truncated' AS extraction_truncated,extraction.result->'office_reading' AS office_reading,extraction.result->'pdf_reading' AS pdf_reading,(extraction.result->'device_content')-'manifest' AS device_content
 FROM schoolvault.sources s LEFT JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.source_id=s.id AND v.id=s.current_version
 LEFT JOIN LATERAL (
  SELECT j.status,j.result FROM schoolvault.jobs j WHERE j.user_id=s.user_id AND (j.kind='extract' OR j.kind='collect' AND j.input->>'task'='device-content-v1')
   AND j.input->>'source_id'=s.id::text
   AND (j.input->>'version_id'=v.id::text OR j.result->>'version_id'=v.id::text)
  ORDER BY j.created_at DESC,j.id DESC LIMIT 1
 ) extraction ON true WHERE s.user_id=$1`,[user])).rows;
 const discovered=(await c.query("SELECT s.course_id,o.coverage->'files' AS files,(o.coverage->>'files_truncated'='true') AS files_truncated FROM schoolvault.moodle_observations o JOIN schoolvault.sources s ON s.user_id=o.user_id AND s.id=o.source_id WHERE o.user_id=$1 AND o.coverage ? 'files'",[user])).rows;
 const byCourse=new Map<string,any[]>();for(const source of sources){const group=byCourse.get(source.course_id)||[];group.push(source);byCourse.set(source.course_id,group);}
 return courses.map(({course_title,...row})=>{
  const owned=byCourse.get(row.course_id)||[];
  const readiness:CourseReadiness={state:'no_content',complete:false,observed_pages:row.captured_pages,readable_pages:0,title_or_link_only_pages:0,indexed_sources:0,personal_notes:0,ai_study_drafts:0,
   attachments:{stored:0,readable:0,pending:0,failed:0,not_indexed:0,truncated:0},categories:Object.fromEntries(contentCategories.map(category=>[category,0])) as CourseReadiness['categories'],
   last_collection_at:row.last_capture?new Date(row.last_capture).toISOString():null,
   limitations:['Only saved text can be searched; readable text does not establish complete coverage or AI understanding.','Hidden or unloaded Moodle content, uncollected attachments and external material may be missing.','Activity text and deadlines do not verify completion, submission or grades.']};
  let pdfs=0,searchable_pdfs=0;
  for(const source of owned){
   if(source.kind==='ai_draft'){readiness.ai_study_drafts++;continue;}
   const body=typeof source.body==='string'?source.body:'';
   const content=classifyMoodleContent({url:source.original_url,title:source.title,course_title,body});
   const readable=content.text_state==='readable',indexed=readable&&source.indexed===true;
   if(indexed)readiness.indexed_sources++;
   if(source.kind==='note')readiness.personal_notes++;
   if(source.kind==='moodle'){
    if(readable)readiness.readable_pages++;else readiness.title_or_link_only_pages++;
    readiness.categories[content.category]++;
   }else if(source.kind==='file')readiness.categories.material++;
   else readiness.categories.other++;
   if(source.mime==='application/pdf'){pdfs++;if(indexed)searchable_pdfs++;}
   if(source.object_key||source.device_content){
    const attachment=readiness.attachments;attachment.stored++;if(source.device_content?.original_location==='device_only')attachment.device_only=(attachment.device_only||0)+1;
    if(indexed)attachment.readable++;
    if(!indexed)attachment.not_indexed++;
    if(source.extraction_status==='queued'||source.extraction_status==='leased')attachment.pending++;
    if(source.extraction_status==='failed')attachment.failed++;
    if(source.extraction_status==='complete'&&source.extraction_truncated==='true')attachment.truncated++;
    if(source.office_reading?.images_total)attachment.partial=(attachment.partial||0)+1;
    if(source.mime==='application/pdf'&&source.extraction_status==='complete'&&partialPdf(source.pdf_reading))attachment.partial=(attachment.partial||0)+1;
   }
  }
  if(readiness.attachments.device_only)readiness.limitations.push('Some originals are reported as retained on the Companion device. The server stores extracted text and recovery references, not those original bytes.');
  const inventory=fileInventory(owned,discovered.filter(x=>x.course_id===row.course_id));
  const inventoryGaps=inventory.files.some(f=>['not_collected','unsupported'].includes(f.state))||inventory.truncated;
  const a=readiness.attachments;
  const gaps=inventoryGaps||readiness.title_or_link_only_pages>0||a.pending>0||a.failed>0||a.not_indexed>0||a.truncated>0||!!a.partial||Number(row.capture_issues)>0;
  readiness.state=readiness.indexed_sources===0?'no_content':gaps?'limited':'readable';
  if(readiness.title_or_link_only_pages)readiness.limitations.push('Some saved Moodle pages contain only a title, navigation or a file link; their underlying instructions or material are not readable here.');
  if(a.pending)readiness.limitations.push('Some saved attachments are waiting for text extraction.');
  if(a.failed)readiness.limitations.push('Some saved attachments could not be read; scanned, encrypted or unsupported documents need readable text.');
  if(a.truncated)readiness.limitations.push('Some extracted attachments are truncated; the original is preserved.');
  if(a.partial)readiness.limitations.push('Some PDFs have missing pages or unreviewed equations, visuals or table layout. Check their originals and page-specific reading gaps.');
  if(a.not_indexed&&!a.pending&&!a.failed)readiness.limitations.push('Some stored attachments have no current searchable text.');
  if(Number(row.capture_issues)>0)readiness.limitations.push('The latest saved captures report collection gaps.');
  return {...row,course_title,pdfs,searchable_pdfs,file_inventory:inventory.files,file_inventory_truncated:inventory.truncated,work_complete:false,completion_verified:false,readiness};
 });
}
