type Draft={title:string;body:string;version:number;transcript?:string};
// A save acknowledges its snapshot. Later keystrokes belong to the next revision.
export function acknowledgeSave<T extends Draft>(current:T,submitted:T,saved:T){
 const fields=['title','body','transcript'] as const;
 const changed=fields.filter(field=>current[field]!==submitted[field]);
 const draft={...saved};for(const field of changed)Object.assign(draft,{[field]:current[field]});
 return {draft,dirty:changed.length>0};
}
