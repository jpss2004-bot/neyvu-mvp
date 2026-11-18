export type StudySlot={day:number;start:string;end:string};
export type StudyAvailability={timezone:string;slots:StudySlot[]};
export type SavedAvailability=StudyAvailability&{id:string;revision:number;updated_at?:string};
export const weekdays=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
export function minute(value:string){return /^\d{2}:\d{2}$/.test(value)&&Number(value.slice(0,2))<=24&&Number(value.slice(3))<60&&(value.slice(0,2)!=='24'||value.slice(3)==='00')?Number(value.slice(0,2))*60+Number(value.slice(3)):NaN;}
export function validateAvailability(value:unknown):StudyAvailability{
 const v=value as StudyAvailability;
 if(!v||typeof v.timezone!=='string'||!Array.isArray(v.slots)||v.slots.length>14)throw Error('Enter a valid study schedule.');
 try{new Intl.DateTimeFormat('en',{timeZone:v.timezone}).format();}catch{throw Error('Choose a valid timezone.');}
 const slots=v.slots.map(s=>{if(!s||!Number.isInteger(s.day)||s.day<0||s.day>6||typeof s.start!=='string'||typeof s.end!=='string'||!Number.isFinite(minute(s.start))||!Number.isFinite(minute(s.end))||minute(s.start)>=minute(s.end))throw Error('Choose a start before the end for each study window.');return {day:s.day,start:s.start,end:s.end};}).sort((a,b)=>a.day-b.day||a.start.localeCompare(b.start));
 if(slots.some((s,i)=>i&&slots[i-1].day===s.day&&minute(slots[i-1].end)>minute(s.start)))throw Error('Study windows on the same day cannot overlap.');
 return {timezone:v.timezone,slots};
}
export function availabilityBody(value:unknown){const v=validateAvailability(value);return 'My recurring study availability\nTimezone: '+v.timezone+'\n'+v.slots.map(s=>weekdays[s.day]+': '+s.start+'-'+s.end).join('\n');}
export function parseAvailability(body:string):StudyAvailability{
 const [heading,zone,...lines]=body.trim().split('\n');if(heading!=='My recurring study availability'||!zone?.startsWith('Timezone: '))throw Error('Study availability needs its timezone and daily windows.');
 return validateAvailability({timezone:zone.slice(10),slots:lines.filter(Boolean).map(line=>{const m=line.match(/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday): (\d{2}:\d{2})-(\d{2}:\d{2})$/);if(!m)throw Error('Use a day and a start-end time for each study window.');return {day:weekdays.indexOf(m[1]),start:m[2],end:m[3]};})});
}
