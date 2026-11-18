import {workInstructionExcerpts} from './moodle-facts';

export const contentCategories=['course_overview','assignment','quiz','discussion','material','announcement','other'] as const;
export type MoodleContentCategory=(typeof contentCategories)[number];
export type MoodleTextState='empty'|'title_only'|'link_only'|'readable';
export type MoodleContent={category:MoodleContentCategory;role:'overview'|'observed_content';text_state:MoodleTextState;characters:number;readable_characters:number;instruction_count:number};

const normalized=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const navigation=/^(?:skip to main content|home|site home|dashboard|my courses|course navigation|calendar|participants|grades|search|expand all|collapse all|back to course|edit mode|completion requirements|view|mark as done|done|not done)\s*:?$/i;
const linkLabel=/^(?:https?:\/\/\S+|(?:click|select|open)\b.*\b(?:view|access|download|open)\b.*\b(?:file|pdf|resource|document|material|link)\b.*|download(?:\s+(?:file|pdf|resource|document|material))?\s*|\S.*\.(?:pdf|txt|md|docx?|pptx?|xlsx?|zip|mp4)(?:\s*\([^)]*\))?)$/i;

// Saved visible text is not authorship, authority, model comprehension or
// complete Moodle coverage. Short actual instructions still count as text.
export function classifyMoodleContent(input:{url?:string|null;title:string;course_title?:string;body:string}):MoodleContent{
 let path='';try{path=new URL(input.url||'').pathname;}catch{}
 let category:MoodleContentCategory='other';
 if(path==='/course/view.php')category='course_overview';
 else if(path.startsWith('/mod/assign/'))category='assignment';
 else if(path.startsWith('/mod/quiz/'))category='quiz';
 else if(path.startsWith('/mod/forum/'))category=/^(?:announcements?|(?:course\s+)?news)(?:\b|$)/i.test(input.title.trim())?'announcement':'discussion';
 else if(/^\/mod\/(?:page|book|folder|resource|url|lesson|workshop)\//.test(path)||path.startsWith('/pluginfile.php/'))category='material';
 const titles=new Set([input.title,input.course_title||''].map(normalized).filter(Boolean));
 const visible=input.body.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
 const content=visible.filter(line=>!navigation.test(line)&&!titles.has(normalized(line)));
 const actual=content.filter(line=>!linkLabel.test(line));
 const text_state:MoodleTextState=!input.body.trim()?'empty':!content.length?'title_only':!actual.length?'link_only':'readable';
 const instructions=workInstructionExcerpts(input.body);
 const substantive=instructions.length>0||actual.some(line=>line.length>=80&&/[.!?]/.test(line));
 return {category,role:category==='course_overview'&&!substantive?'overview':'observed_content',text_state,
  characters:input.body.trim().length,readable_characters:actual.join('\n').length,instruction_count:instructions.length};
}

export type CourseReadiness={state:'no_content'|'limited'|'readable';complete:false;observed_pages:number;readable_pages:number;title_or_link_only_pages:number;indexed_sources:number;personal_notes:number;ai_study_drafts:number;attachments:{stored:number;readable:number;pending:number;failed:number;not_indexed:number;truncated:number;partial?:number;device_only?:number};categories:Record<MoodleContentCategory,number>;last_collection_at:string|null;limitations:string[]};
