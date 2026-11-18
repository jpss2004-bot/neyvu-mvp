import type {PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

// D1/D2 storage for the learner knowledge graph (migration 040). Extraction is
// done by scripts/knowledge_graph.py (natural keys, no ids); this module stores
// it with validity times and projects the current graph back into the worker
// job. A changed fact closes the old row (valid_to) and inserts a new one, so
// history is kept. Flag: SCHOOL_BETA_KNOWLEDGE_GRAPH=1 (default off).
export const knowledgeGraphEnabled=()=>process.env.SCHOOL_BETA_KNOWLEDGE_GRAPH==='1';

type Proof={source_id:string|null;version_id:string|null;proof_ref:string|null};
export type GraphEntity=Proof&{key:string;kind:string;label:string;attrs:Record<string,unknown>;course_id:string|null;authority:string;extractor:string;confidence:number};
export type GraphEdge=Proof&{relation:string;from:string;to:string;attrs:Record<string,unknown>;authority:string;extractor:string;confidence:number};
export type GraphEvidence={entity?:string;edge?:[string,string,string];source_id:string;version_id:string;quote:string;char_start:number|null;char_end:number|null;extractor:string;confidence:number};
export type Extraction={entities:GraphEntity[];edges:GraphEdge[];evidence:GraphEvidence[]};

const same=(a:any,b:any)=>isDeepStrictEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)));
const entityFacts=(e:any)=>({kind:e.kind,label:e.label,attrs:e.attrs,course_id:e.course_id??null,source_id:e.source_id??null,version_id:e.version_id??null,proof_ref:e.proof_ref??null,authority:e.authority,extractor:e.extractor,confidence:Number(e.confidence)});
const edgeFacts=(e:any)=>({attrs:e.attrs,source_id:e.source_id??null,version_id:e.version_id??null,proof_ref:e.proof_ref??null,authority:e.authority,extractor:e.extractor,confidence:Number(e.confidence)});

// Job-local facts (proof_ref 'job-source:...') are never stored.
const storable=(p:Proof)=>!!p.version_id||!!p.proof_ref&&!p.proof_ref.startsWith('job-source:');

export async function storeExtraction(c:PoolClient,user:string,x:Extraction,now=new Date()){
 const ids=new Map<string,string>(),stats={entities_inserted:0,entities_kept:0,entities_closed:0,edges_inserted:0,edges_kept:0,edges_closed:0,evidence_inserted:0};
 for(const e of x.entities.filter(storable)){
  const old=(await c.query('SELECT id,kind,label,attrs,course_id,source_id,version_id,proof_ref,authority,extractor,confidence FROM schoolvault.kg_entities WHERE user_id=$1 AND key=$2 AND valid_to IS NULL FOR UPDATE',[user,e.key])).rows[0];
  if(old&&same(entityFacts(old),entityFacts(e))){ids.set(e.key,old.id);stats.entities_kept++;continue;}
  if(old){
   await c.query('UPDATE schoolvault.kg_entities SET valid_to=$3 WHERE user_id=$1 AND id=$2',[user,old.id,now]);
   // Relations of a closed entity end with it; current extraction re-adds those that still hold.
   const closed=await c.query('UPDATE schoolvault.kg_edges SET valid_to=$3 WHERE user_id=$1 AND (from_entity=$2 OR to_entity=$2) AND valid_to IS NULL',[user,old.id,now]);
   stats.entities_closed++;stats.edges_closed+=closed.rowCount??0;
  }
  const id=randomUUID(),f=entityFacts(e);
  await c.query('INSERT INTO schoolvault.kg_entities(user_id,id,kind,key,label,attrs,course_id,source_id,version_id,proof_ref,authority,extractor,confidence,valid_from) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
   [user,id,f.kind,e.key,f.label,JSON.stringify(f.attrs),f.course_id,f.source_id,f.version_id,f.proof_ref,f.authority,f.extractor,f.confidence,now]);
  ids.set(e.key,id);stats.entities_inserted++;
 }
 const edgeIds=new Map<string,string>();
 for(const e of x.edges.filter(storable)){
  const from=ids.get(e.from),to=ids.get(e.to);if(!from||!to)continue;
  const k=JSON.stringify([e.relation,e.from,e.to]);
  const old=(await c.query('SELECT id,attrs,source_id,version_id,proof_ref,authority,extractor,confidence FROM schoolvault.kg_edges WHERE user_id=$1 AND relation=$2 AND from_entity=$3 AND to_entity=$4 AND valid_to IS NULL FOR UPDATE',[user,e.relation,from,to])).rows[0];
  if(old&&same(edgeFacts(old),edgeFacts(e))){edgeIds.set(k,old.id);stats.edges_kept++;continue;}
  if(old){await c.query('UPDATE schoolvault.kg_edges SET valid_to=$3 WHERE user_id=$1 AND id=$2',[user,old.id,now]);stats.edges_closed++;}
  const id=randomUUID(),f=edgeFacts(e);
  await c.query('INSERT INTO schoolvault.kg_edges(user_id,id,relation,from_entity,to_entity,attrs,source_id,version_id,proof_ref,authority,extractor,confidence,valid_from) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
   [user,id,e.relation,from,to,JSON.stringify(f.attrs),f.source_id,f.version_id,f.proof_ref,f.authority,f.extractor,f.confidence,now]);
  edgeIds.set(k,id);stats.edges_inserted++;
 }
 for(const v of x.evidence){
  if(!v.version_id)continue;
  const entity=v.entity?ids.get(v.entity)??null:null,edge=v.edge?edgeIds.get(JSON.stringify(v.edge))??null:null;
  if(!entity===!edge)continue;
  const exists=(await c.query('SELECT 1 FROM schoolvault.kg_evidence WHERE user_id=$1 AND entity_id IS NOT DISTINCT FROM $2 AND edge_id IS NOT DISTINCT FROM $3 AND version_id=$4 AND quote=$5',[user,entity,edge,v.version_id,v.quote])).rowCount;
  if(exists)continue;
  await c.query('INSERT INTO schoolvault.kg_evidence(user_id,id,entity_id,edge_id,source_id,version_id,quote,char_start,char_end,extractor,confidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
   [user,randomUUID(),entity,edge,v.source_id,v.version_id,v.quote,v.char_start,v.char_end,v.extractor,v.confidence]);
  stats.evidence_inserted++;
 }
 return stats;
}

// Current graph for some courses, in the key-based shape knowledge_graph.Graph reads.
export async function graphProjection(c:PoolClient,user:string,courses:string[]):Promise<Extraction>{
 const rows=(await c.query('SELECT id,key,kind,label,attrs,course_id,source_id,version_id,proof_ref,authority,extractor,confidence FROM schoolvault.kg_entities WHERE user_id=$1 AND valid_to IS NULL AND course_id=ANY($2::uuid[]) ORDER BY key LIMIT 2000',[user,courses])).rows;
 const keys=new Map(rows.map(r=>[r.id as string,r.key as string]));
 const edges=(await c.query('SELECT id,relation,from_entity,to_entity,attrs,source_id,version_id,proof_ref,authority,extractor,confidence FROM schoolvault.kg_edges WHERE user_id=$1 AND valid_to IS NULL AND from_entity=ANY($2::uuid[]) AND to_entity=ANY($2::uuid[]) ORDER BY created_at,id LIMIT 4000',[user,[...keys.keys()]])).rows;
 const edgeKeys=new Map(edges.map(e=>[e.id as string,[e.relation,keys.get(e.from_entity)!,keys.get(e.to_entity)!] as [string,string,string]]));
 const evidence=(await c.query('SELECT entity_id,edge_id,source_id,version_id,quote,char_start,char_end,extractor,confidence FROM schoolvault.kg_evidence WHERE user_id=$1 AND (entity_id=ANY($2::uuid[]) OR edge_id=ANY($3::uuid[])) ORDER BY created_at,id LIMIT 4000',[user,[...keys.keys()],[...edgeKeys.keys()]])).rows;
 return {
  entities:rows.map(({id,...r})=>({...r,confidence:Number(r.confidence)})) as GraphEntity[],
  edges:edges.map(e=>({relation:e.relation,from:keys.get(e.from_entity)!,to:keys.get(e.to_entity)!,attrs:e.attrs,source_id:e.source_id,version_id:e.version_id,proof_ref:e.proof_ref,authority:e.authority,extractor:e.extractor,confidence:Number(e.confidence)})),
  evidence:evidence.map(v=>({...(v.entity_id?{entity:keys.get(v.entity_id)}:{edge:edgeKeys.get(v.edge_id)}),source_id:v.source_id,version_id:v.version_id,quote:v.quote,char_start:v.char_start,char_end:v.char_end,extractor:v.extractor,confidence:Number(v.confidence)})) as GraphEvidence[],
 };
}
