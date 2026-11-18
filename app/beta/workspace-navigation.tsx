'use client';
import type {MouseEvent} from 'react';
import {MessageSquare,CalendarDays,BookOpen,FileText,AudioLines,Bell,Link2,Settings} from 'lucide-react';
import {useI18n} from './language';
const primary=[{key:'today',label:'Today',Icon:CalendarDays},{key:'chat',label:'Chat',Icon:MessageSquare},{key:'sources',label:'Courses',Icon:FileText},{key:'calendar',label:'Calendar',Icon:CalendarDays},{key:'notes',label:'Notes',Icon:BookOpen}];
type Props={tab:string;local:boolean;captureEnabled:boolean;unseenUpdates:number;href:(tab:string)=>string;onNavigate:(e:MouseEvent<HTMLAnchorElement>,tab:string)=>void;mobile?:boolean};
export default function WorkspaceNavigation({tab,local,captureEnabled,unseenUpdates,href,onNavigate,mobile=false}:Props){
 const {t}=useI18n();
 const secondary=[...(captureEnabled?[{key:'classes',label:'Class recordings',Icon:AudioLines}]:[]),{key:'updates',label:'Updates',Icon:Bell},{key:'connection',label:local?'Personal vault':'Moodle',Icon:Link2},{key:'settings',label:'Settings',Icon:Settings}];
 function links(items:typeof primary){return items.map(({key,label,Icon})=><a key={key} href={href(key)} aria-label={t(label)} title={t(label)} aria-current={tab===key?'page':undefined} onClick={e=>onNavigate(e,key)}><Icon size={20} aria-hidden="true"/><span>{t(label)}</span>{key==='updates'&&unseenUpdates>0&&<span className="nu-nav-count">{unseenUpdates}</span>}</a>);}
 return <nav className={mobile?'nu-mobile-dock':'nu-app-navigation'} aria-label={t(mobile?'Quick navigation':'Workspace')}><div>{links(primary)}</div>{!mobile&&<div className="nu-secondary-navigation">{links(secondary)}</div>}</nav>;
}
