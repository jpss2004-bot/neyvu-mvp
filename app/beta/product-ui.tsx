import {courseTone} from '../../lib/beta/course-identity';
import type {ReactNode} from 'react';
import './product-ui.css';

/** Shared hierarchy for live product views and illustrative marketing views. */
export function ProductHeading({title,description,children}:{title:string;description:string;children?:ReactNode}) {
 return <div className="nu-heading"><div><h1>{title}</h1><p>{description}</p></div>{children&&<div className="nu-heading-tools">{children}</div>}</div>;
}
export function CourseContext({code,children}:{code:string;children?:ReactNode}) {
 return <span className="nu-course" data-course-tone={courseTone(code)}><span className="nu-course-mark" aria-hidden="true"/><span className="nu-course-label">{code}</span>{children&&<span className="nu-course-detail">{children}</span>}</span>;
}
export function EvidenceLabel({children}:{children:ReactNode}) {return <div className="nu-evidence-label">{children}</div>;}
