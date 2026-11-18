// Operator-only preview: no credentials in argv, logs, registry or output.
// This does not enroll a provider in production or save any imported records.
import {readFile} from 'node:fs/promises';
import {CanvasReader,BrightspaceReader} from '../lib/lms/adapters';
import {LmsError,row,label,origin} from '../lib/lms/read-only';

async function main(){
 const registryPath=process.argv[2];
 if(!registryPath||process.argv.length!==3)throw new LmsError('configuration');
 const raw=await readFile(registryPath,'utf8');if(raw.length>32000)throw new LmsError('configuration');
 const registered=row(JSON.parse(raw));let input='';
 for await(const chunk of process.stdin){input+=chunk;if(input.length>16000)throw new LmsError('configuration');}
 const request=row(JSON.parse(input)),institution=label(request.institution),entry=row(registered[institution]);
 // A reviewed registry is required even for previews; an arbitrary URL is not
 // an institution enrollment. OAuth acquisition/refresh belongs in a separate
 // institution-approved flow, never a student paste-token onboarding screen.
 if(entry.approval!=='operator-preview-only')throw new LmsError('configuration');
 const approvedOrigin=origin(label(entry.origin)),config={origin:approvedOrigin,approvedOrigins:[approvedOrigin],accessToken:label(request.accessToken)};
 const reader=entry.provider==='canvas'?new CanvasReader(config):entry.provider==='brightspace'?new BrightspaceReader({...config,lpVersion:label(entry.lpVersion),leVersion:label(entry.leVersion)}):null;
 if(!reader)throw new LmsError('configuration');
 const identity=label(request.expectedIdentity);
 const result=request.operation==='courses'?await reader.courses(identity):request.operation==='assignments'?await reader.assignments(identity,label(request.courseId),new Date().toISOString()):null;
 if(!result)throw new LmsError('configuration');
 process.stdout.write(JSON.stringify({preview:true,persisted:false,...result})+'\n');
}
main().catch(error=>{process.stderr.write(JSON.stringify({preview:true,error:error instanceof LmsError?error.code:'configuration'})+'\n');process.exitCode=1;});
