/** Export the runtime-only frontend graph. Never copy the private repo to Vercel.
 * Run root tsc before export: type-only imports are intentionally erased here.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const EXT=['','.ts','.tsx','.js','.jsx','.css','.json'];
const allowedPackages=new Set(['next','react','react-dom','react-markdown','rehype-katex','remark-math','katex','lucide-react','server-only']);
const forbidden=/^(node:|pg$|jose$|qrcode$)|(?:^|\/)(?:auth|db|config|vault|worker|admissions|admin-mail|approval-mail|files|demo-data)\.[jt]sx?$/;
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);}
export function prepareFrontend(destination,{root=ROOT,preview=false,local=false}={}){
 if(preview&&local)throw Error('Choose one frontend profile');
 root=fs.realpathSync(root);destination=path.resolve(destination);
 if(fs.existsSync(destination))throw Error('Use a fresh frontend export directory');
 const overrides=new Map([
 ['lib/beta/page-data.ts',preview?'deploy/frontend/preview-page-data.ts':'deploy/frontend/page-data.ts'],
 ]);
 const mappings=new Map([
 [preview?'deploy/frontend/preview-layout.tsx':'deploy/beta-layout.tsx','app/layout.jsx'],['deploy/beta-home.tsx','app/page.jsx'],
 ['deploy/frontend/robots.ts','app/robots.js'],['deploy/frontend/sitemap.ts','app/sitemap.js'],
 ['deploy/frontend/next.config.ts','next.config.mjs'],
 [preview?'deploy/frontend/preview-proxy.ts':local?'deploy/frontend/local-proxy.ts':'deploy/frontend/proxy.ts','proxy.js'],
 [preview?'deploy/frontend/preview-page-data.ts':'deploy/frontend/page-data.ts','lib/beta/page-data.js'],
 ['deploy/frontend/transport-config.ts','lib/frontend/transport-config.js'],
 ]);
 if(preview)mappings.set('deploy/frontend/preview-api.ts','app/api/beta/[[...path]]/route.js');
 if(local)mappings.set('deploy/frontend/local-api.ts','app/api/beta/[[...path]]/route.js');
 const output=new Map(),records=[];
 const target=s=>mappings.get(s)||s.replace(/\.tsx$/,'.jsx').replace(/\.ts$/,'.js');
 function source(s){return overrides.get(s)||s;}
 function resolve(s,spec){
  const base=path.resolve(root,path.dirname(s),spec);
  const found=EXT.map(ext=>base+ext).find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());
  if(!found)throw Error('Unresolved frontend import: '+s+' -> '+spec);
  return source(path.relative(root,found));
 }
 function visit(input){
  const s=source(input),p=path.resolve(root,s),out=target(s);
  if(output.has(out))return;
  if(!p.startsWith(root+path.sep)||fs.realpathSync(p)!==p||fs.lstatSync(p).isSymbolicLink())throw Error('Unsafe frontend source: '+s);
  if(forbidden.test(s))throw Error('Backend implementation in frontend graph: '+s);
  if(!/^(app\/beta\/|lib\/beta\/|lib\/brand\.|deploy\/(frontend\/|beta-(layout|home)\.))/.test(s))throw Error('Source outside frontend allowlist: '+s);
  if(/^app\/beta\/auth\//.test(s))throw Error('Auth implementation belongs to Render');
  const raw=fs.readFileSync(p),code=/\.[jt]sx?$/.test(s);
  output.set(out,null);
  let content=raw;
  if(code){
   const transpiled=ts.transpileModule(raw.toString(),{fileName:s,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.Preserve,verbatimModuleSyntax:false,sourceMap:false}}).outputText;
   const ast=ts.createSourceFile(s,transpiled,ts.ScriptTarget.Latest,true,s.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.JS),replacements=[];
   function scan(node){
    let lit;
    if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier)lit=node.moduleSpecifier;
    if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||node.expression.getText(ast)==='require')){
     if(node.arguments.length!==1||!ts.isStringLiteral(node.arguments[0]))throw Error('Nonliteral frontend dependency in '+s);
     lit=node.arguments[0];
    }
    if(lit){
     if(!ts.isStringLiteral(lit))throw Error('Invalid frontend import in '+s);
     const spec=lit.text;
     if(spec.startsWith('.')){
      const dep=resolve(s,spec);visit(dep);let relative=path.relative(path.dirname(out),target(dep)).split(path.sep).join('/');if(!relative.startsWith('.'))relative='./'+relative;
      replacements.push([lit.getStart(ast),lit.getEnd(),JSON.stringify(relative)]);
     }else{const pkg=spec.startsWith('@')?spec.split('/').slice(0,2).join('/'):spec.split('/')[0];if(!allowedPackages.has(pkg)&&!(local&&s==='deploy/frontend/local-api.ts'&&['node:http','node:stream'].includes(spec)))throw Error('Unapproved frontend package: '+spec+' in '+s);}
    }
    ts.forEachChild(node,scan);
   }
   scan(ast);let result=transpiled;for(const [a,b,v] of replacements.sort((a,b)=>b[0]-a[0]))result=result.slice(0,a)+v+result.slice(b);content=Buffer.from(result);
  }
  output.set(out,content);records.push({source:s,path:out,source_sha256:sha(raw),sha256:sha(content)});
 }
 const entries=files(path.join(root,'app/beta')).map(p=>path.relative(root,p)).filter(s=>/(?:^|\/)(?:page|layout|loading)\.tsx$/.test(s)||s==='app/beta/manifest.webmanifest/route.ts');
 for(const s of [...entries,...mappings.keys()])visit(s);
 for(const dir of ['public/brand','public/beta-product','public/beta-demo'])for(const p of files(path.join(root,dir))){
  if(fs.lstatSync(p).isSymbolicLink()||!(/\.(png|jpg|webp|svg|woff2|mp4|ico|icns|txt|md)$/.test(p)))throw Error('Unexpected public asset: '+p);
  const relative=path.relative(root,p),bytes=fs.readFileSync(p);output.set(relative,bytes);records.push({source:relative,path:relative,source_sha256:sha(bytes),sha256:sha(bytes)});
 }
 const original=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
 const pkg={name:'neyvu-web',version:'0.1.0',private:true,type:'module',scripts:{build:'next build',start:'next start'},dependencies:Object.fromEntries(Object.entries(original.dependencies).filter(([k])=>allowedPackages.has(k)))};
 output.set('package.json',Buffer.from(JSON.stringify(pkg,null,2)+'\n'));
 output.set('vercel.json',Buffer.from(JSON.stringify({framework:'nextjs',skipMiddlewareRequestBody:true,regions:['iad1']},null,2)+'\n'));
 const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 const dirty=Boolean(execFileSync('git',['status','--porcelain','--untracked-files=all'],{cwd:root,encoding:'utf8'}).trim());
 const manifest={format:'neyvu-frontend-export/1',profile:preview?'synthetic-preview':local?'local-render-api':'render-api',source_commit:commit,source_dirty:dirty,type_validation:'Run root tsc before release',private_backend_code_included:false,files:records.sort((a,b)=>a.path.localeCompare(b.path)),generated:[...output].filter(([p])=>!records.some(r=>r.path===p)).map(([p,b])=>({path:p,sha256:sha(b)}))};

 for(const [p,bytes] of output){const dest=path.join(destination,p);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes);}
 fs.copyFileSync(path.join(root,'package-lock.json'),path.join(destination,'package-lock.json'));
 execFileSync('npm',['install','--package-lock-only','--offline','--ignore-scripts','--no-audit','--no-fund'],{cwd:destination,stdio:'pipe'});
 const lock=fs.readFileSync(path.join(destination,'package-lock.json'));
 manifest.generated.push({path:'package-lock.json',sha256:sha(lock)});
 manifest.lock_source_sha256=sha(fs.readFileSync(path.join(root,'package-lock.json')));
 fs.writeFileSync(path.join(destination,'EXPORT-PROVENANCE.json'),JSON.stringify(manifest,null,2)+'\n');
 return {destination,profile:manifest.profile,files:output.size,source_commit:commit,source_dirty:dirty};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(!process.argv[2])throw Error('Usage: node scripts/prepare_frontend.mjs FRESH_DIRECTORY [--preview|--local]');
 console.log(JSON.stringify(prepareFrontend(process.argv[2],{preview:process.argv.includes('--preview'),local:process.argv.includes('--local')})));
}
