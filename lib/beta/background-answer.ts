type BackgroundJob={id:string;kind:string;chat_id:string|null;status:string};
export function backgroundAnswer<T extends BackgroundJob>(jobs:T[],chatId:string|null):T|null {
 const pending=jobs.filter(j=>j.kind==='answer'&&j.chat_id&&['queued','leased'].includes(j.status));
 return pending.find(j=>j.chat_id===chatId)||pending[0]||null;
}
