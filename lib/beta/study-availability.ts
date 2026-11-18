import {listStudentMemory,saveStudentMemory} from './student-memory';
import {availabilityBody,parseAvailability} from './availability-format';
import {BetaHttpError} from './http';
import {BetaConflict} from './vault';
export async function readStudyAvailability(user:string){const memory=(await listStudentMemory(user,null,null)).find(m=>m.kind==='availability');return memory?{id:memory.id,revision:memory.revision,updated_at:memory.updated_at,...parseAvailability(memory.body)}:null;}
export async function saveStudyAvailability(user:string,input:any){
 let body:string;try{body=availabilityBody(input);}catch(error){throw new BetaHttpError((error as Error).message);}
 const old=await readStudyAvailability(user);if(input.id&&input.id!==old?.id)throw new BetaConflict('Your study availability changed. Reload it before saving.');
 try{const row=await saveStudentMemory(user,{...input,kind:'availability',course_id:null,chat_id:null,body});return {id:row.id,revision:row.revision,updated_at:row.updated_at,...parseAvailability(row.body)};}
 catch(error){if((error as {code?:string}).code==='23505')throw new BetaConflict('Your study availability changed. Reload it before saving.');throw error;}
}
