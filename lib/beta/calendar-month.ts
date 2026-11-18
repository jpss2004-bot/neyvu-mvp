import {addDays,weekStart} from './agenda';

export function calendarDate(value:string|null){
 if(!value||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
 const date=new Date(value+'T12:00:00Z');
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value?value:null;
}
export function calendarMonth(value:string|null){return calendarDate(value)&&value!.endsWith('-01')?value:null;}
export function shiftMonth(date:string,amount:number){
 if(!calendarDate(date)||!Number.isSafeInteger(amount))throw Error('Invalid calendar date');
 const first=new Date(date.slice(0,7)+'-01T12:00:00Z');first.setUTCMonth(first.getUTCMonth()+amount);
 const last=new Date(first);last.setUTCMonth(last.getUTCMonth()+1);last.setUTCDate(0);
 first.setUTCDate(Math.min(Number(date.slice(-2)),last.getUTCDate()));
 return first.toISOString().slice(0,10);
}
export function monthDays(month:string){
 if(!calendarMonth(month))throw Error('Invalid calendar month');
 const start=weekStart(month);return Array.from({length:42},(_,i)=>addDays(start,i));
}
