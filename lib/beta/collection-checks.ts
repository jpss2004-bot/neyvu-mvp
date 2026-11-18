// Explain saved collection observations without implying that every omission is a crash.
export function collectionCheck(reason:string){
 if(/10 MiB file size limit/i.test(reason))return {kind:'size',label:'File too large',action:'Open the original in Moodle or add a smaller readable copy.'};
 if(/10 MiB file or remaining refresh/i.test(reason))return {kind:'size_or_budget',label:'File size or refresh limit',action:'This older report does not distinguish file size from remaining capacity. The original is not saved.'};
 if(/external|unsupported|outside Moodle/i.test(reason))return {kind:'outside',label:'Outside automatic reading',action:'Open these items in Moodle. You can add a supported copy you have access to.'};
 if(/HTTP 5\d\d|timed out|timeout|net::ERR_|could not finish/i.test(reason))return {kind:'retry',label:'Read interrupted',action:'Saved material is kept. Companion can retry when the connection is ready.'};
 if(/budget|limit|more than 200|waiting/i.test(reason))return {kind:'remaining',label:'More material to collect',action:'Keep Companion open for the next pass. This material is not readable yet.'};
 if(/embedded|scanned|encrypted|readable|empty/i.test(reason))return {kind:'text',label:'Text still missing',action:'Check the original before relying on an answer about this material.'};
 if(/collapsed|not loaded|pagination/i.test(reason))return {kind:'page',label:'Part of a page was not read',action:'Open the affected course in Moodle and check the expanded page.'};
 return {kind:'review',label:'Material needs a check',action:'Compare this course’s saved sources with Moodle.'};
}
