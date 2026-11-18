import type {ReactNode} from 'react';
import {BookOpen,FolderOpen,Search,CloudOff} from 'lucide-react';

/** A view state describes what happened and leaves a concrete next action. */
export default function WorkspaceState({kind='notes',title,description,actionLabel,onAction,disabled=false,compact=false,heading,announce=false,children}:{kind?:'notes'|'sources'|'search'|'error';title:string;description:string;actionLabel?:string;onAction?:()=>void;disabled?:boolean;compact?:boolean;heading?:'h1'|'h2'|'h3';announce?:boolean;children?:ReactNode}){
 const Icon={notes:BookOpen,sources:FolderOpen,search:Search,error:CloudOff}[kind];
 const Heading=heading??(compact?'h3':'h2');
 return <section className={'nu-state-panel'+(compact?' nu-state-compact':'')} data-state={kind} role={announce?'alert':undefined}>
  <span className="nu-state-glyph" aria-hidden="true"><Icon size={compact?22:30} strokeWidth={1.5}/></span>
  <Heading>{title}</Heading><p>{description}</p>
  {(onAction||children)&&<div className="nu-state-actions">{onAction&&actionLabel&&<button type="button" disabled={disabled} onClick={onAction}>{actionLabel}</button>}{children}</div>}
 </section>;
}

/** Decorative placeholders match the eventual content; no fake progress is exposed. */
export function WorkspaceSkeleton(){
 return <div className="nu-workspace-skeleton" aria-hidden="true"><div className="nu-skeleton-heading"><span/><span/></div><div className="nu-skeleton-content"><div className="nu-skeleton-list">{[0,1,2].map(i=><div key={i}><i/><span><b/><b/></span></div>)}</div><div className="nu-skeleton-reading"><span/><span/><span/><span/></div></div></div>;
}
