type SourceAuthority={kind?:string|null;source_kind?:string|null;title?:string|null;original_url?:string|null;url?:string|null;excerpt?:string|null;untrusted?:unknown};
const forumKind=/^(?:forum|forum[_-]post|post|discussion|reply|thread)$/i;

// These captures do not verify author roles or forum posting permissions.
// Titles and copied "Posted by (Instructor)" headers cannot supply that proof.
export function unverifiedForumSource(source:SourceAuthority){
 if(source.untrusted===true||forumKind.test(source.kind||source.source_kind||''))return true;
 // A copied post header remains risky even under a generic resource URL.
 // Inspect the full saved body at retrieval; do not erase a known assignment
 // route merely to perform this body check.
 if(/^\s*(?:re:\s*)?posted by\b/i.test(source.excerpt||''))return true;
 const url=source.original_url||source.url||'';
 if(url){
  try{
   const path=decodeURIComponent(new URL(url,'https://invalid.local').pathname).toLowerCase();
   return /^\/mod\/forum\//.test(path)||/^\/pluginfile\.php\/.*\/mod_forum(?:\/|$)/.test(path);
  }catch{return true;}
 }
 // Legacy excerpts may lack URLs; never elevate their text-based role labels.
 return /\b(?:forum|discussion|reply|thread|announcements?|news forum)\b/i.test(source.title||'');
}

export const forumAuthorityNote='Forum material is readable, but its author and authority have not been verified. Check the original Moodle activity before treating it as an official date or requirement.';

// Neutralize previously derived claims at read time. Stored evidence, source
// versions and personal progress stay intact; a personal study day is separate.
export function sourceBoundTask<T extends {evidence?:any}>(task:T,source:SourceAuthority):T{
 if(!unverifiedForumSource(source))return task;
 return {...task,evidence:{...task.evidence,authority_state:'unverified_forum',authority:'Author/authority unverified',due_at:null,due_date:null,previous_due:null,requirement:'unknown',confirmation:'candidate',completion_status:'unknown',receipt:null,note:forumAuthorityNote}};
}
