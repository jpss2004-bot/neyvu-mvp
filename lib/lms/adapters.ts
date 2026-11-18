import {ReadOnlyLms, LmsError, row, rows, id, label, explicitDate, canvasPage, brightspacePage, type ReadConfig, type Course, type Assignment} from './read-only';

// These readers are local qualification candidates. Production OAuth consent,
// encrypted per-student grants and durable ingestion are deliberately not wired
// to an unauthenticated or student-controlled endpoint.
export class CanvasReader {
 private readonly api: ReadOnlyLms;
 constructor(config:ReadConfig) { this.api = new ReadOnlyLms(config); }
 async identity() { return id(row((await this.api.get('/api/v1/users/self/profile','/api/v1/users/self/profile')).data).id); }
 async courses(expectedIdentity:string) {
  if (await this.identity() !== id(expectedIdentity)) throw new LmsError('identity_changed');
  const page = await this.api.list('/api/v1/courses?enrollment_type=student&enrollment_state=active&per_page=100','/api/v1/courses',canvasPage);
  const courses:Course[] = page.items.map(c => ({provider:'canvas',origin:this.api.origin,externalId:id(c.id),code:label(c.course_code),title:label(c.name)}));
  return {...page,items:courses};
 }
 async assignments(expectedIdentity:string, selectedCourse:string, observedAt:string) {
  const courseId = id(selectedCourse), identityId = id(expectedIdentity), observed = explicitDate(observedAt);
  if (!observed) throw new LmsError('configuration');
  const enrolled = await this.courses(identityId);
  if (!enrolled.items.some(c => c.externalId === courseId)) throw new LmsError(enrolled.complete ? 'boundary' : 'budget');
  const path = `/api/v1/courses/${courseId}/assignments`, page = await this.api.list(path+'?per_page=100',path,canvasPage);
  const assignments:Assignment[] = page.items.map(a => {
   const externalId=id(a.id);
   if (a.course_id !== undefined && id(a.course_id) !== courseId) throw new LmsError('boundary');
   if (a.description !== null && a.description !== undefined && typeof a.description !== 'string') throw new LmsError('invalid_response');
   return {provider:'canvas',origin:this.api.origin,identityId,courseId,externalId,title:label(a.name),originalUrl:`${this.api.origin}/courses/${courseId}/assignments/${externalId}`,observedAt:observed,instructions:(a.description as string|null)||'',instructionsFormat:'html',dueAt:explicitDate(a.due_at),submission:'unverified',grade:'unverified'};
  });
  return {...page,items:assignments};
 }
}

export class BrightspaceReader {
 private readonly api:ReadOnlyLms;
 private readonly lp:string;
 private readonly le:string;
 constructor(config:ReadConfig & {lpVersion:string; leVersion:string}) {
  this.api=new ReadOnlyLms(config);
  if (![config.lpVersion,config.leVersion].every(v => /^1\.\d{1,3}$/.test(v))) throw new LmsError('configuration');
  // Versions are negotiated/registered per institution, not inferred from UI.
  this.lp=config.lpVersion;this.le=config.leVersion;
 }
 async identity() { return id(row((await this.api.get(`/d2l/api/lp/${this.lp}/users/whoami`,`/d2l/api/lp/${this.lp}/users/whoami`)).data).Identifier); }
 async courses(expectedIdentity:string) {
  if (await this.identity() !== id(expectedIdentity)) throw new LmsError('identity_changed');
  const path=`/d2l/api/lp/${this.lp}/enrollments/myenrollments/`,page=await this.api.list(path,path,brightspacePage);
  const courses:Course[]=page.items.map(e => row(e.OrgUnit)).filter(c => row(c.Type).Id === 3).map(c => ({provider:'brightspace',origin:this.api.origin,externalId:id(c.Id),code:label(c.Code),title:label(c.Name)}));
  return {...page,items:courses};
 }
 async assignments(expectedIdentity:string,selectedCourse:string,observedAt:string) {
  const courseId=id(selectedCourse),identityId=id(expectedIdentity),observed=explicitDate(observedAt);
  if(!observed)throw new LmsError('configuration');
  const enrolled=await this.courses(identityId);
  if(!enrolled.items.some(c=>c.externalId===courseId))throw new LmsError(enrolled.complete?'boundary':'budget');
  const path=`/d2l/api/le/${this.le}/${courseId}/dropbox/folders/`,folders=rows((await this.api.get(path,path)).data);
  if(folders.length>5000)throw new LmsError('budget');
  const assignments:Assignment[]=folders.map(a=>{
   const externalId=id(a.Id),instructions=a.Instructions===null||a.Instructions===undefined?{}:row(a.Instructions);
   if(instructions.Html!==undefined&&typeof instructions.Html!=='string'||instructions.Text!==undefined&&typeof instructions.Text!=='string')throw new LmsError('invalid_response');
   return {provider:'brightspace',origin:this.api.origin,identityId,courseId,externalId,title:label(a.Name),originalUrl:`${this.api.origin}/d2l/lms/dropbox/user/folder_submit_files.d2l?db=${externalId}&ou=${courseId}`,observedAt:observed,instructions:typeof instructions.Html==='string'&&instructions.Html?instructions.Html:typeof instructions.Text==='string'?instructions.Text:'',instructionsFormat:instructions.Html?'html':'text',dueAt:explicitDate(a.DueDate),submission:'unverified',grade:'unverified'};
  });
  return {items:assignments,complete:true,continuation:null};
 }
}
