export type LibrarySource={id:string;course_id:string;title:string;kind:string;version_id:string;observed_at:string;mime?:string;bytes?:number;original_url?:string};
export type SourceLibraryPage={sources:LibrarySource[];total:number;limit:number;next_cursor:string|null};
