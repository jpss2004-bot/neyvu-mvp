'use client';
import {useI18n} from "./language";
import type {SourceContent} from '../../lib/beta/source-content';
export default function SourceLimitations({content}:{content:SourceContent}){
 const {t:ui}=useI18n();
 const limits=content.limitations.filter(limit=>/^(?:Legacy PowerPoint|No selectable text|Only \d+ of \d+ PDF pages|Local OCR|PDF pages)/.test(limit));
 if(content.state!=='partial'&&content.state!=='no_text'&&!limits.length)return null;
 return <section className="beta-source-limitations" aria-label={ui("Reading limitations")}><strong>{content.state==='no_text'?ui("This source has no readable text yet"):ui("This source needs review")}</strong><p>{ui("The assistant can use only the saved text. Check the original for missing pages, diagrams and equations.")}</p>{limits.map(limit=><p key={limit}>{ui(limit)}</p>)}</section>;
}
