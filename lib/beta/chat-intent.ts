import {addDays,weekStart,zoneDate} from './agenda';

type Turn={role:string;text?:string};
// A progress report about one numbered item does not cancel a separate request
// to prioritize the remaining work in the same message.
export const workStatusOverview=(question:string)=>! /\b(?:assignment|homework|quiz|test|exam|lab|worksheet|report)\s+\d+\b/i.test(question)&&/^\s*(?:what have (?:I|we) (?:already )?(?:submitted|finished)|(?:show|list) (?:my |our )?(?:submissions|submitted work))\b/i.test(question);
export const workPriorityQuestion=(question:string)=>/\b(?:prioriti[sz]e|rank)\b.{0,60}\b(?:remaining|work|tasks?|courses?|next|this week|next week)\b|\bwhat\s+should\s+(?:I|we)\s+(?:work on|do)\s+next\b/i.test(question);
export const nextDeadlineQuestion=(question:string)=>/^\s*(?:what(?:['’]s| is)|which is)\s+(?:(?:my|our|the)\s+)?next\s+(?:deadline|due date)(?:\s+(?:in|for)\s+[a-z]{2,5}[ -]?\d{3,4}[a-z]?)?\s*[?.!]*\s*$/i.test(question);
const dayFollowup=(question:string)=>/\b(?:focus on|work on|let(?:'s| us) (?:do|plan)|plan)\s+(?:my |this |next )?(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i.test(question);
const elliptical=(question:string)=>{
 // "This week" names a period, not a prior topic. Other pronouns and explicit
 // follow-up openings still retain the student's earlier topic.
 const topic=question.replace(/\bthis\s+(?:week|month|term|semester|year)\b/gi,'');
 return dayFollowup(question)||/^(?:and\b|what about\b|how about\b|for\b|then\b|when is (?:it|that)\b|what (?:is|does) (?:it|that)\b|(?:can|could) you (?:explain|expand|clarify|continue)\b|(?:why|how|when|where|tomorrow|today)\??$)/i.test(question)||/\b(?:it|that|this|those|these|they|them)\b/i.test(topic);
};
// Earlier student turns help retrieve the topic of a follow-up. Assistant answers
// are never promoted to source evidence, and a new explicit topic stands alone.
export function conversationQuery(question:string,history:Turn[]){
 const short=question.trim();
 if(short.length>240||!elliptical(short))return short;
 const prior=history.filter(t=>t.role==='user'&&t.text?.trim()&&t.text.trim()!==short).slice(-3).reverse(),topics:string[]=[];
 for(const turn of prior){const text=turn.text!.trim();topics.push(text);if(text.length>240||!elliptical(text))break;}
 return topics.length?short+'\nPrevious student topic: '+topics.join('\nEarlier student topic: ').slice(0,1200):short;
}

// Inventory questions concern all work, even when a student says "assignments".
// A request for one numbered activity's facts, a solution, weight or policy is
// still a normal question rather than an inventory request.
export function workInventoryQuestion(question:string){
 if(workStatusOverview(question)||workPriorityQuestion(question)||nextDeadlineQuestion(question))return true;
 if(workFactQuestion(question))return false;
 // Students ask for their list with ordinary phrasing, not just "what work
 // do I have". Keep this after the fact/receipt/solution exclusions.
 const listNoun='(?:to[ \\-\u2011]?dos?|to[ \\-\u2011]?do list|tasks?|work|homework|assessments?|assignments?|quiz(?:zes)?|labs?|worksheets?|readings?|deadlines?)';
 if(new RegExp('\\b(?:what(?:\'s| is| are)|which|show(?: me)?|list|give me|summarize)\\s+(?:on\\s+)?(?:(?:my|our|the|upcoming|weekly|remaining|current)\\s+){0,3}'+listNoun+'\\b(?:.{0,70}\\b(?:today|tomorrow|this week|next week|week ahead|have|need|due|upcoming)\\b|\\s*[?.!]*\\s*$)','i').test(question)
  ||/\b(?:help me\s+)?plan\s+(?:(?:my|our|the|this|next)\s+)?week(?:\s+ahead)?\b/i.test(question))return true;
 const noun='(?:work|homework|assessments?|assignments?|tasks?|quiz(?:zes)?|labs?|lab (?:quiz(?:zes)?|reports?)|reports?|exercises?|in[- ]class (?:work|assignments?|exercises?)|worksheets?|discussions?|readings?|preparation|prep|deadlines?)';
 return new RegExp('\\b(?:what|which)\\s+(?:(?:my|our|the)\\s+)?'+noun+'\\b.{0,45}\\b(?:have|need|due|upcoming|this week|today|tomorrow|turn in|hand in|submit|are there|is there|prepare)\\b|^\\s*(?:what|which)\\s+(?:(?:my|our)\\s+)?'+noun+'\\s*\\??\\s*$|\\bwhat\\s+(?:do|should|must)\\s+(?:i|we)\\s+(?:need to\\s+)?(?:do|have|complete|prepare|work on|turn in|hand in|submit|bring)\\b|\\bwhat\\s+(?:do|should|must)\\s+(?:i|we)\\s+need\\s+(?:to\\s+(?:do|prepare|complete|bring)|for\\s+(?:class|lab))\\b|\\b(?:do|will)\\s+(?:i|we)\\s+have\\b.{0,40}(?:'+noun+'|anything|something)\\b|\\b(?:is|are)\\s+there\\b.{0,25}(?:'+noun+'|anything|something)\\b|\\b(?:anything|something|nothing)\\b.{0,45}\\b(?:due|turn in|hand in|submit|do|prepare|complete)\\b|^\\s*any\\b.{0,20}\\b'+noun+'\\b|\\b(?:anything|work)\\s+(?:for|before)\\s+(?:class|lab)\\b|\\bwhat(?:\'s| is)\\s+(?:due|left|next|coming up)\\b|\\bam i\\s+(?:done|caught up|all done)\\b','i').test(question);
}

function workFactQuestion(question:string){
 if(workStatusOverview(question)||workPriorityQuestion(question))return false;
 return /\b(?:how much|how many|how long|worth|weights?|percentage|definition|solve|solution|calculate|prove|derive|write|explain|determinant|matri(?:x|ces)|proof|eigenvalue|eigenvector|exam(?:ination)?s?|allowed|permission|policy|rules?|grade|graded|score|mark)\b|^\s*(?:when (?:is|are)|what time|which room|where (?:is|are))\b|\b(?:can|may|could)\s+(?:i|we)\b.*\b(?:use|collaborate)\b/i.test(question)
 ||/\b(?:assignment|homework|quiz|test|exam|lab|worksheet|report|exercise|chapter|question|part)\s+(?:\d+|[IVX]+|one|two|three|four|five)\b/i.test(question)
 ||/\b(?:did|have)\s+(?:i|we)\s+(?:already\s+)?(?:submitted|submit|turned in|handed in|completed|complete|finished|finish|done)\b|\b(?:work|assignments?|tasks?|quizzes|quiz|labs?|worksheets?)\b.{0,35}\b(?:have|did)\s+(?:i|we)\s+(?:complete|completed|finished|finish|submit|submitted|done)\b|\b(?:is|are)\b.{0,35}\b(?:work|assignment|task|quiz|lab|worksheet)\b.{0,25}\b(?:completed|finished|done|submitted)\b/i.test(question);
}

export function conversationInventory(question:string,history:Turn[]){
 if(workFactQuestion(question))return false;
 if(workInventoryQuestion(question))return true;
 if(question.length>180||!dayFollowup(question)&&!/^\s*(?:and\b|what about\b|how about\b|for\b|then\b|tomorrow\??$|today\??$)/i.test(question))return false;
 const turns=history.filter(t=>t.role==='user'&&t.text?.trim()&&t.text.trim()!==question.trim()).slice(-3).reverse();
 for(const turn of turns){const prior=turn.text!;if(workFactQuestion(prior))return false;if(workInventoryQuestion(prior))return true;if(!/^\s*(?:and\b|what about\b|how about\b|for\b|then\b|tomorrow\??$|today\??$)/i.test(prior))return false;}
 return false;
}

export function conversationWorkWindowQuestion(question:string,history:Turn[]){
 // A new explicit period wins; earlier "tomorrow" must not override "this week".
 if(/\b(?:today|tomorrow|this week|next week|week ahead|next (?:seven|7) days)\b/i.test(question)||workInventoryQuestion(question))return question;
 return conversationInventory(question,history)?conversationQuery(question,history):question;
}

export function workWindow(question:string,instant:number|Date,zone:string){
 const today=zoneDate(instant,zone),monday=weekStart(today);
 const day=question.match(/\b(?:focus on|work on|let(?:'s| us) (?:do|plan)|plan)\s+(?:my |this |next )?(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i);
 if(day){const index=['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].indexOf(day[1].toLowerCase()),date=addDays(monday,index+(/\bnext\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i.test(day[0])?7:0));return {start:date,end:date,label:(/\bnext\s+/i.test(day[0])?'next ':'')+day[1][0].toUpperCase()+day[1].slice(1).toLowerCase()};}
 if(/\btomorrow\b/i.test(question))return {start:addDays(today,1),end:addDays(today,1),label:'tomorrow'};
 if(/\btoday\b/i.test(question))return {start:today,end:today,label:'today'};
 if(/\bnext week\b/i.test(question))return {start:addDays(monday,7),end:addDays(monday,13),label:'next week'};
 if(/\b(?:week ahead|next (?:seven|7) days)\b/i.test(question))return {start:today,end:addDays(today,6),label:'the next seven days'};
 if(/\b(?:this week|plan (?:my|our|the) week)\b/i.test(question))return {start:monday,end:addDays(monday,6),label:'this week'};
 return {start:today,end:addDays(today,13),label:'the next two weeks'};
}
