import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {writingActivity} from './writing-target';
import {excerptCoverage} from './excerpt-coverage';
import {unverifiedForumSource} from './source-authority';

// Supporting personal material stays distinct from the assignment originals.
// A title match selects candidates, not authority or proof of achievements.
export async function featuredWritingSources(c:PoolClient,user:string,course:string|null,q:string){
 if(!course||!writingActivity(q)||! /\b(?:Featured|portfolio|(?:research|Acadia)\s+(?:announcement|post))\b/i.test(q))return [];
 const rows=(await c.query(`SELECT s.id,s.title,s.kind,s.course_id,s.original_url,s.current_version,v.id AS version_id,v.observed_at,v.body AS full_body
 FROM schoolvault.sources s JOIN schoolvault.source_versions v ON v.user_id=s.user_id AND v.source_id=s.id AND v.id=s.current_version
 WHERE s.user_id=$1 AND s.course_id=$2 AND s.kind IN('note','file') AND length(v.body)<=60000
 AND s.title ~* '(saved.*featured.*items|featured.*(posts|capture)|summer.*(portfolio|report))'
 ORDER BY v.observed_at DESC,s.id LIMIT 8`,[user,course])).rows;
 const selected=new Map<string,any>();
 for(const s of rows){
  if(unverifiedForumSource({...s,excerpt:s.full_body}))continue;
  const kind=/linkedin\.com\/feed\/update\/urn:li:activity:\d+\//.test(s.full_body)?'featured_posts':
   /Every project in this portfolio[\s\S]{0,180}problem, what I built and the outcome/.test(s.full_body)?'portfolio_page':null;
  if(!kind||selected.has(kind))continue;
  selected.set(kind,{...s,excerpt:s.full_body,excerpt_coverage:excerptCoverage(s,s.full_body,s.full_body),
   writing_material:{format:1,kind,source_id:s.id,version_id:s.version_id,text_sha256:createHash('sha256').update(s.full_body).digest('hex'),authority:'personal_material_not_assignment_requirement'}});
 }
 return [...selected.values()];
}
