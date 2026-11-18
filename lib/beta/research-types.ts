export const citationStyles={apa:'APA',mla:'MLA',chicago:'Chicago author-date'} as const;
export type CitationStyle=keyof typeof citationStyles;
export type ReferenceMetadata={title:string;author:string;year:string;type:'document'|'article-journal'|'book'|'webpage'|'speech';container:string;publisher:string;volume:string;issue:string;pages:string;doi:string;url:string};
export type ResearchReference={number:number;id?:string;version_id?:string;title:string;href?:string;state:string;revision:number;metadata:ReferenceMetadata;provenance:string;missing:string[]};
export type ResearchExportView={message_id:string;course_id:string|null;course_label:string|null;style:CitationStyle|null;style_revision:number;style_evidence?:{quote:string;source_id:string;version_id:string};style_conflict?:boolean;references:ResearchReference[]};
export type FormattedResearch={html:string;text:string;warnings:string[];references:{number:number;text:string}[]};
