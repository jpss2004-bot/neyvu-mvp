/** Preserve manual reading; on a new answer expose its beginning, not its footer. */
export function conversationScrollTarget({following,assistant,answerTop,bottom,empty}:{following:boolean;assistant:boolean;answerTop:number|null;bottom:number;empty:boolean}):number|null {
 if(empty)return 0;
 if(!following)return null;
 return assistant&&answerTop!==null?Math.max(0,answerTop-12):bottom;
}
