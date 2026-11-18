import type {PoolClient} from 'pg';
import {institutionEvidenceEnabled} from './flags';
// C7: public university evidence for an answer. It comes from the separate
// institution_public schema, is selected by the learner's configured institution
// on the server, and is always labelled apart from the learner's course sources.
export type InstitutionEvidence={
 label:'institution source';visibility:'public_institution';institution_id:string;
 source_id:string;version_id:string;sha256:string;title:string;url:string;page:number|null;
 excerpt:string;captured_at:string;review_state:string;applicability:string;academic_year:string|null;
 /** Opens the saved original (PDF at the cited page when there is one). */
 open_url:string;flags:string[];
};
const stop=new Set(['how','do','i','a','the','to','is','are','my','can','what','if','it','in','for','and','of','at','where','when','does','an','on','or','me','you','be','with']);
export function evidenceTerms(question:string){
 const words:string[]=question.toLowerCase().match(/[\p{L}\p{N}]+/gu)||[];
 return [...new Set(words.filter(t=>t.length>1&&!stop.has(t)))].slice(0,20);
}
export const institutionOriginalUrl=(versionId:string,page:number|null)=>`/api/beta/institution-sources?version=${encodeURIComponent(versionId)}${page?`#page=${page}`:''}`;

export async function institutionEvidenceFor(c:Pick<PoolClient,'query'>,institutionId:string|null|undefined,question:string,opts:{limit?:number;academicYear?:string|null}={}):Promise<InstitutionEvidence[]>{
 if(!institutionId||!/^[a-z0-9][a-z0-9-]{0,62}$/.test(institutionId))return [];
 const terms=evidenceTerms(question);if(!terms.length)return [];
 // Terms are passed as plain lexemes joined with OR; nothing from the question becomes query syntax.
 const rows=(await c.query(`WITH q AS (SELECT to_tsquery('english',string_agg(quote_literal(plainto_tsquery('english',t)::text),' | ')) AS query FROM unnest($2::text[]) t WHERE plainto_tsquery('english',t)::text<>'')
  SELECT DISTINCT ON (s.id) s.id source_id,s.title,s.url,s.applicability,s.academic_year,v.id version_id,v.sha256,v.captured_at,v.review_state,v.flags,p.page,p.text,ts_rank(p.search,q.query) AS rank
  FROM q,institution_public.passages p JOIN institution_public.versions v ON v.id=p.version_id JOIN institution_public.sources s ON s.id=v.source_id AND s.current_version=v.id
  WHERE s.institution_id=$1 AND p.search@@q.query AND ($3::text IS NULL AND s.applicability NOT IN ('historical','future') OR s.academic_year IS NULL OR s.academic_year=$3)
  ORDER BY s.id,rank DESC`,[institutionId,terms,opts.academicYear??null])).rows;
 return rows.sort((a,b)=>b.rank-a.rank).slice(0,Math.max(1,Math.min(opts.limit??4,8))).map(r=>({
  label:'institution source',visibility:'public_institution',institution_id:institutionId,source_id:r.source_id,version_id:r.version_id,sha256:r.sha256,
  title:r.title,url:r.url,page:r.page,excerpt:String(r.text).slice(0,1600),captured_at:new Date(r.captured_at).toISOString(),review_state:r.review_state,
  applicability:r.applicability,academic_year:r.academic_year,open_url:institutionOriginalUrl(r.version_id,r.page),flags:Array.isArray(r.flags)?r.flags:[],
 }));
}

/** Evidence for one learner's answer, or [] when the flag is off or no institution is set. */
export async function answerInstitutionEvidence(c:Pick<PoolClient,'query'>,user:string,question:string){
 if(!institutionEvidenceEnabled())return [];
 const institution=(await c.query('SELECT institution_id FROM schoolvault.users WHERE id=$1',[user])).rows[0]?.institution_id;
 return institutionEvidenceFor(c,institution,question);
}
