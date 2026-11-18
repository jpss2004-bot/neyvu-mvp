'use client';
import {useI18n} from "./language";
import type {SourceContent} from '../../lib/beta/source-content';
// The existing black/white palette, system type and focus treatment continue.
// One expandable reading guide precedes the complete original text.
export default function SourceGuide({content}:{content:SourceContent}){
 const {t:ui}=useI18n();
 if(content.state==='no_text')return <p>{ui("No readable content is available yet. Check the original and the document reading status.")}</p>;
 return <details className="beta-reading-guide"><summary>{ui("Reading guide")}</summary>
  <p>{content.authority==='student_notes'?ui("Your notes"):content.authority==='ai_draft'?ui("AI study draft"):ui("Saved source text")}{ui(". Review these quotations in context; this guide does not verify completion.")}</p>
  {!!content.outline.length&&<details><summary>{ui("Contents")}</summary><ul>{content.outline.map((item,i)=><li key={i}>{item.heading} <small>{ui("Line")} {item.start_line}</small></li>)}</ul></details>}
  {content.evidence.length?<ul>{content.evidence.map((item,i)=><li key={i}><small>{item.kind==='rubric'?ui("Assessment criteria"):item.kind==='submission'?ui("Submission wording"):item.kind==='definition'?ui("Definition wording"):ui("Instruction wording")} · {item.unit?item.unit+', ':''}{ui("Lines")} {item.start_line}–{item.end_line}</small><blockquote>{item.quote}</blockquote></li>)}</ul>:<p>{ui(content.omission_count?"Some guide entries are not shown. Review their locations in the full saved text below.":"No specific instructions were identified. Use the full text below to study this source.")}</p>}
  {!!content.omission_count&&<section aria-label={ui('Not quoted in this guide')}><p role="status">{ui('Omitted guide entries: {count}.',{count:content.omission_count})}</p><ul>{content.omissions?.map((item,i)=><li key={i}><small>{item.unit?item.unit+' · ':''}{ui('Lines')} {item.start_line}–{item.end_line}</small><p>{ui(item.reason==='passage_too_long'?'This block is too long to quote without cutting its context.':'The guide limit was reached.')}</p></li>)}</ul>{content.omissions_truncated&&<p>{ui('More locations are omitted from this list. Review the full saved text below.')}</p>}</section>}
  {content.limitations.filter(limit=>/^(?:Legacy PowerPoint|No selectable text|Only \d+ of \d+ PDF pages|Local OCR|PDF pages)/.test(limit)).map(limit=><p role="status" key={limit}>{ui(limit)}</p>)}
  <p>{content.state==='partial'?ui("The saved text has gaps or may be truncated."):''}{ui("Diagrams and visual layout may need the original.")}</p>
 </details>;
}
