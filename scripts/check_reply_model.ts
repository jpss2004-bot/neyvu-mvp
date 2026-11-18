// Bounded local model evaluation. Fictional extracts; no database or saved chat writes.
import {localAI} from '../lib/local-model';
import {parseModelReply,replySchema,replyInstruction,replyClock} from '../lib/replies';
import {writeFileSync,existsSync,readFileSync} from 'node:fs';
const cases=[
 {id:'fact',question:'What is opportunity cost?',sources:[{number:1,title:'Evaluation fixture',excerpt:'Opportunity cost is the value of the next-best alternative forgone when making a choice. For example, spending an hour studying instead of working gives up the wages from that hour.'}]},
 {id:'worked-math',question:'Solve 2x+3=11 and show all steps.',sources:[{number:1,title:'Evaluation fixture',excerpt:'For 2x+3=11, subtract 3 on both sides: 2x=8. Divide by 2: x=4. Check: 2(4)+3=11.'}]},
 {id:'missing-date',question:'When is this assignment due?',sources:[{number:1,title:'Evaluation fixture',excerpt:'A class transcript says there will be a written assignment. It gives no official due date or activity link.'}]}
];
async function main(){const results=[];for(const item of cases.filter(item=>!process.argv[2]||item.id===process.argv[2])){const start=Date.now();try{
 const context=[{role:'system',content:replyInstruction},{role:'user',content:JSON.stringify({...item,...replyClock()})}];
 let reply;let attempts=0;for(;attempts<2;attempts++){const raw=await localAI(context,replySchema);try{reply=parseModelReply(raw,item.question,1);break;}catch(error){if(attempts===1)throw error;context.push({role:'user',content:'The previous response failed validation: '+String(error)+'. Return complete JSON again, copying math operators and values accurately.'});}}
 if(!reply)throw new Error('No parsed reply');const row={id:item.id,attempts:attempts+1,ms:Date.now()-start,words:reply.content.split(/\s+/).length,...reply};results.push(row);console.log(JSON.stringify(row));
 }catch(error){const row={id:item.id,error:String(error),ms:Date.now()-start};results.push(row);console.log(JSON.stringify(row));}}
 const report='service/reply-model-check-2026-09-30.json';
 const previous=existsSync(report)?JSON.parse(readFileSync(report,'utf8')):[];
 writeFileSync(report,JSON.stringify([...previous,...results.map(row=>({...row,checked_at:new Date().toISOString()}))],null,2)+'\n');}
void main();
