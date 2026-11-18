import type {MiniNetwork} from './devices';
import type {Note} from './store';
import type {SchoolData} from './data';
import type {Catalog,Source} from './pilot';
import type {ReplyBlock} from './replies';
import type {ChatThread,ChatTurn} from './chats';
import type {CalendarSchedule} from './calendar';
export type Message={id?:string;role:string;content:string;blocks?:ReplyBlock[];created_at?:string;thread_id?:string;sources:Source[];mode?:string;details?:string;caution?:string;expandDetails?:boolean;detailsLabel?:string};
export type Job={id:string;note_id:string;kind:string;status:string;error?:string;has_result?:boolean};
export type Workspace=Catalog&{school:SchoolData;calendar:CalendarSchedule;threads:ChatThread[];activeChat:{thread:ChatThread;messages:Message[];turns:ChatTurn[];has_more:boolean}|null;notes:Note[];messages:Message[];jobs:Job[];permissions:Record<string,string>;model:string;privateUrl:string|null;mini:MiniNetwork};
export const time=(value:string|null|undefined)=>value?/^\d{4}-\d{2}-\d{2}$/.test(value)?new Date(value+'T12:00:00Z').toLocaleDateString('en-CA',{timeZone:'UTC',month:'short',day:'numeric'}):new Date(value).toLocaleString('en-CA',{timeZone:'America/Halifax',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Not checked';
export async function action(payload:Record<string,unknown>,signal?:AbortSignal){const r=await fetch('/api/pilot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal});const d=await r.json();if(!r.ok)throw Object.assign(new Error(d.error||(d.conflict?'Both copies changed. Your local draft is preserved; review the Notion copy before choosing which to keep.':'Request failed')),{status:r.status});return d;}
