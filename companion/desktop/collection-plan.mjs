import {MOODLE,readURL,MAX_ACTIVITY_PAGES,MAX_FORUM_DISCUSSIONS} from './capture.mjs';
export {captureContent as activityMetadata} from './capture.mjs';
export const MAX_NESTED_DEPTH=2,MAX_BOOK_CHAPTERS=40,MAX_FORUM_INDEX_PAGES=10;

const validPage=dom=>{
 const url=readURL(dom?.url);if(!url)return null;
 const page=new URL(url),isCourse=page.pathname==='/course/view.php',discussion=page.pathname==='/mod/forum/discuss.php';
 if(isCourse?!/^page-course-view-/.test(dom.body_id||''):discussion?dom.body_id!=='page-mod-forum-discuss':dom.body_id!=='page-mod-'+page.pathname.split('/')[2]+'-view')return null;
 return page;
};
const baseView=url=>url.pathname!=='/course/view.php'&&url.pathname.endsWith('/view.php')&&[...url.searchParams.keys()].length===1;
const links=dom=>[...new Set((dom.links||[]).filter(link=>link.collection_link!==false).map(link=>readURL(link.url)).filter(Boolean))];
const linkGaps=dom=>{
 const issues=[];
 for(const link of dom.links||[]){if(link.content_link===false)continue;try{const u=new URL(link.url);
  if(/^https?:$/.test(u.protocol)&&u.origin!==MOODLE)issues.push('External reading or media links are not collected automatically.');
  else if(u.origin===MOODLE&&/^\/mod\/[^/]+\/view\.php$/.test(u.pathname)&&!readURL(u.href)&&[...u.searchParams.keys()].every(key=>key==='id'))issues.push('This page links to an unsupported Moodle activity type; its material was not collected.');
 }catch{}}
 return [...new Set(issues)];
};

// Seeds come only from one checked selected-course page. Chapter/pagination
// URLs require their own parent activity and are never course-level seeds.
export function collectionStart(dom,{afterURL,isComplete=()=>false}={}){
 const page=validPage(dom);if(!page||page.pathname!=='/course/view.php')return {items:[],issues:['The course layout is unsupported; no activity links were followed.']};
 if(typeof isComplete!=='function')return {items:[],issues:['The collection checkpoint is invalid.']};
 const items=links(dom).filter(url=>baseView(new URL(url))&&!isComplete(url)).map(url=>({url,depth:0,kind:'activity'}));
 const previous=items.findIndex(item=>item.url===afterURL);
 if(previous>=0)items.push(...items.splice(0,previous+1));
 return {items:items.slice(0,MAX_ACTIVITY_PAGES),issues:[...linkGaps(dom),...(items.length>MAX_ACTIVITY_PAGES?['This course exceeds the 100 activity/discussion page limit; some pages are not checked.']:[])]};
}

// This is a plan, not a crawler: the engine verifies numeric identity/course
// before each read, owns the global attempt count and records every failed read.
export function collectionFollowups(dom,{depth=0,seen=new Set(),remaining=MAX_ACTIVITY_PAGES,discussions=0,bookChapters=0,forumIndexes=0,lastAttempt=()=>0,isComplete=()=>false,ownedPagination=new Set()}={}){
 const page=validPage(dom),items=[],issues=linkGaps(dom),added={discussions:0,bookChapters:0,forumIndexes:0};
 if(![depth,remaining,discussions,bookChapters,forumIndexes].every(value=>Number.isSafeInteger(value)&&value>=0)||depth>MAX_NESTED_DEPTH||remaining>MAX_ACTIVITY_PAGES||!(seen instanceof Set)||!(ownedPagination instanceof Set)||typeof lastAttempt!=='function'||typeof isComplete!=='function')return {items,issues:['The bounded collection plan was invalid; no deeper links were followed.'],added};
 if(!page)return {items,issues:['The activity layout is unsupported; deeper links were not followed.'],added};
 if(dom.forum_pagination&&(dom.links||[]).some(link=>{try{const u=new URL(link.url);return link.collection_link!==false&&u.origin===MOODLE&&/^\/mod\/forum\/(?:view|discuss)\.php$/.test(u.pathname)&&u.searchParams.has('page')&&!readURL(u.href);}catch{return false;}}))issues.push('This forum uses unsupported pagination; some linked pages were not checked.');
 const candidates=links(dom).filter(url=>!seen.has(url)&&url!==page.href&&!isComplete(url)),sameModule=url=>url.pathname===page.pathname&&url.searchParams.get('id')===page.searchParams.get('id');
 // Rank only freshly observed links. Persisted progress never contributes a
 // URL to this list; attempted pages rotate even when an earlier read failed.
 const rank=url=>{const n=lastAttempt(url);return Number.isSafeInteger(n)&&n>=0?n:0;};
 candidates.sort((a,b)=>rank(a)-rank(b));
 for(const url of candidates){
  const child=new URL(url);let kind=null,nextDepth=depth;
  if(page.pathname==='/mod/forum/view.php'&&child.pathname==='/mod/forum/discuss.php')kind='discussion';
  else if(page.pathname==='/mod/forum/view.php'&&sameModule(child)&&child.searchParams.has('page')){if(page.searchParams.has('page')&&ownedPagination.has(url))continue;kind='forum-index';}
  else if(page.pathname==='/mod/book/view.php'&&sameModule(child)&&child.searchParams.has('chapterid')){if(page.searchParams.has('chapterid'))continue;kind='book-chapter';}
  else if(/^\/mod\/(page|folder|book)\/view.php$/.test(page.pathname)&&baseView(child)){
   if(depth>=MAX_NESTED_DEPTH){issues.push('Linked activity depth reached the two-level limit; some deeper material is not checked.');continue;}
   kind='activity';nextDepth=depth+1;
  }
  if(!kind)continue;
  const counter=kind==='discussion'?'discussions':kind==='book-chapter'?'bookChapters':kind==='forum-index'?'forumIndexes':null;
  const limit=kind==='discussion'?MAX_FORUM_DISCUSSIONS:kind==='book-chapter'?MAX_BOOK_CHAPTERS:kind==='forum-index'?MAX_FORUM_INDEX_PAGES:null;
  const used=counter?({discussions,bookChapters,forumIndexes}[counter]+added[counter]):0;
  if(counter&&used>=limit){issues.push('Collection reached the '+limit+' '+(kind==='discussion'?'discussion':kind==='book-chapter'?'book chapter':'forum index page')+' limit; some linked content is not checked.');continue;}
  if(items.length>=Math.max(0,Math.min(MAX_ACTIVITY_PAGES,remaining))){issues.push('Following linked content reaches the 100 activity/discussion page limit; some material is not checked.');continue;}
  items.push({url,depth:nextDepth,kind});if(counter)added[counter]++;
 }
 return {items,issues:[...new Set(issues)],added};
}
