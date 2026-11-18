export function studyCopyDate(value:string,timezone:string){
 try{return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,dateStyle:'long',timeStyle:'short'}).format(new Date(value));}
 catch{return new Date(value).toISOString();}
}
