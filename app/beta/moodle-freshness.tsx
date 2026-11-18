'use client';
import {useI18n} from "./language";

import {moodleFreshness,type CourseCapture} from '../../lib/beta/freshness';
export default function MoodleFreshness({coverage,scope,now,timezone,onConnect}:{coverage:CourseCapture[];scope?:string[];now:Date|null;timezone:string;onConnect:()=>void}){
 const {t:ui,locale}=useI18n();
 if(!now)return null;
 const value=moodleFreshness(coverage,now,scope);
 if(value.state==='fresh')return null;
 const date=value.oldest?new Intl.DateTimeFormat(locale,{timeZone:timezone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value.oldest)):null;
 return <section className="beta-freshness" aria-label={ui("Moodle freshness")}><details><summary>{value.state==='missing'?ui("Moodle has not been collected yet"):value.state==='unknown'?ui("Moodle freshness could not be established"):ui("Moodle may be out of date")}</summary><p>{date?ui("The oldest selected course was last checked")+' '+date+'. ':''}{value.missingCourses.length?ui("Some selected courses have no saved Moodle pages."):''}{ui("You can use saved material, but new instructions, dates or announcements may be missing.")}</p></details><button onClick={onConnect}>{value.state==='missing'?ui("Connect Moodle"):ui("Refresh Moodle")}</button></section>;
}
