import {AsyncLocalStorage} from 'node:async_hooks';
import {BetaHttpError} from './http';

type Operation={release:(()=>void)[];closed:boolean};
const shared=globalThis as typeof globalThis&{__neyvuBodyBudget?:{reserved:number;operations:AsyncLocalStorage<Operation>}};
const budget=shared.__neyvuBodyBudget??={reserved:0,operations:new AsyncLocalStorage<Operation>()};
export const bodyBudgetBytes=32*1024*1024;

// JSON/capture bodies share the same raw-buffer budget as original uploads.
// Keep their reservation until the route finishes using the parsed content.
export async function bodyOperation<T>(run:()=>Promise<T>):Promise<T>{
 const existing=budget.operations.getStore();if(existing&&!existing.closed)return run();
 const operation:Operation={release:[],closed:false};
 return budget.operations.run(operation,async()=>{try{return await run();}finally{operation.closed=true;for(const release of operation.release)release();}});
}
export function reserveBody(bytes:number){
 const operation=budget.operations.getStore();if(!operation||operation.closed)throw Error('Missing body operation');
 if(bytes>bodyBudgetBytes-budget.reserved)throw new BetaHttpError('Uploads are busy. Wait for the current upload to finish, then try again.',429);
 budget.reserved+=bytes;operation.release.push(()=>{budget.reserved-=bytes;});
}
