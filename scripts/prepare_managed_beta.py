"""Export the School multi-user code only. Does not upload or deploy anything."""
from pathlib import Path
import hashlib,json,shutil,subprocess,zipfile

ROOT=Path(__file__).resolve().parents[1]
DIRS=('app/beta','app/(server)','app/api/beta','app/api/oauth','app/.well-known','app/mcp','lib/beta','lib/platform','packages/connectors/src','deploy/migrations','public/brand','public/beta-product','public/beta-demo','public/citation-licenses')
FILES={'proxy.ts':'proxy.ts','packages/connectors/institutions.json':'packages/connectors/institutions.json','package.json':'package.json','package-lock.json':'package-lock.json','tsconfig.json':'tsconfig.json',
       'scripts/moodle_post_verifier.py':'scripts/moodle_post_verifier.py',
       'next-env.d.ts':'next-env.d.ts','lib/brand.ts':'lib/brand.ts','deploy/beta-layout.tsx':'app/layout.tsx',
       'deploy/beta-home.tsx':'app/page.tsx','app/not-found.tsx':'app/not-found.tsx','deploy/beta-next.config.ts':'next.config.ts',
       'deploy/beta-robots.ts':'app/robots.ts','deploy/beta-sitemap.ts':'app/sitemap.ts',
       'deploy/Dockerfile.beta':'Dockerfile','deploy/render-beta.review.yaml':'render.review.yaml',
       'scripts/migrate-beta.mjs':'scripts/migrate-beta.mjs','scripts/beta_maintenance.mjs':'scripts/beta_maintenance.mjs','scripts/usb_delivery_text.mjs':'scripts/usb_delivery_text.mjs','deploy/beta-entrypoint.mjs':'beta-entrypoint.mjs',
       'public/icon-192.png':'public/icon-192.png','public/icon-512.png':'public/icon-512.png',
       'deploy/windows-companion.yml':'.github/workflows/windows-companion.yml',
       'deploy/desktop-installer.yml':'.github/workflows/desktop-installer.yml',
       'deploy/store-package.yml':'.github/workflows/store-package.yml',
       'deploy/vercel-beta.json':'vercel.json'}

def source_map(root=ROOT):
    result=dict(FILES)
    for name in DIRS:
        for p in (root/name).rglob('*'):
            if p.is_file():result[str(p.relative_to(root))]=str(p.relative_to(root))
    for name in ['package.json','package-lock.json','main.cjs','preload.cjs','engine.mjs','engine.test.mjs','connector-recovery.test.mjs','course-membership.mjs','course-membership.test.mjs','collection-plan.mjs','collection-plan.test.mjs','collection-navigation.mjs','collection-navigation.test.mjs','attachment-read.mjs','content-packet.mjs','content-upload.mjs','content-journal.mjs','content-collector.mjs','native-pdf-reader.mjs','native-package.mjs','original-recovery.mjs','native-pdf.swift','build-native-pdf.cjs','attachment-read.test.mjs','collection-progress.test.mjs','collection-memory.mjs','collection-memory.test.mjs','handoff.mjs','handoff.test.mjs','installed.test.mjs','capture.mjs','capture.test.mjs','receipt-capture.test.mjs','preflight.mjs','preflight.test.mjs','protocol.mjs','package-integrity.cjs','package-integrity.test.mjs','icon.ico','store-config.cjs','build-store.cjs','store-config.test.mjs','store-identity.json','build/appx/StoreLogo.png','build/appx/Square150x150Logo.png','build/appx/Square44x44Logo.png','build/appx/Wide310x150Logo.png','ui/index.html','ui/style.css','ui/app.js']:
        src='companion/desktop/'+name;result[src]=src
    # The desktop package's explicit test command is shipped with this export.
    # Include its course/launcher regressions as well as their pure text helper.
    for name in ['usb-launcher.test.mjs','course-list.test.mjs','generic-courses.test.mjs','course-selection-renderer.test.mjs','window-lifecycle.cjs','connection-storage.cjs','window-lifecycle.test.cjs','connection-storage.test.cjs','file-inventory.test.mjs']:
        src='companion/desktop/'+name;result[src]=src
    for name in ['today.png','today-phone.png','notebook.png','notebook-phone.png','source.png','source-phone.png']:
        src='public/beta-product/'+name;result[src]=src
    result['companion/desktop/build-mac.cjs']='companion/desktop/build-mac.cjs'
    result['companion/desktop/build-windows-local.cjs']='companion/desktop/build-windows-local.cjs'
    result['companion/desktop/build-brand-assets.cjs']='companion/desktop/build-brand-assets.cjs'
    result['companion/desktop/package-mac-dmg.cjs']='companion/desktop/package-mac-dmg.cjs'
    result['companion/desktop/icon.icns']='companion/desktop/icon.icns'
    for src in result:
        p=root/src
        if not p.is_file() or p.is_symlink() or root.resolve() not in p.resolve().parents:
            raise ValueError('Missing or unsafe source: '+src)
        if str(p.relative_to(root)) not in {'public/citation-licenses/CPAL','public/citation-licenses/LICENSE'} and p.suffix not in {'.ts','.tsx','.css','.sql','.mjs','.cjs','.js','.py','.html','.json','.png','.jpg','.webp','.svg','.txt','.md','.woff2','.mp4','.ico','.icns','.swift','.csl','.xml','.beta','.yaml','.yml','.zip'}:
            raise ValueError('Unexpected beta source: '+src)
    return result

PROVENANCE='EXPORT-PROVENANCE.json'

def _git(root,*args):
    try:
        result=subprocess.run(['git','-C',str(root),*args],capture_output=True,text=True,timeout=60)
    except (OSError,subprocess.TimeoutExpired):return None
    return result.stdout.strip() if result.returncode==0 else None

def manifest_digest(files):
    # Order-independent digest of {source, path, sha256} rows; scripts/predeploy_gate.py recomputes it.
    lines=sorted('%s\0%s\0%s\n'%(f['source'],f['path'],f['sha256']) for f in files)
    return hashlib.sha256(''.join(lines).encode()).hexdigest()

def provenance(root=ROOT,sources=None):
    """Record which source commit/tree produced this export. Deterministic: no timestamps."""
    sources=source_map(root) if sources is None else sources
    files=[{'source':src,'path':target,'sha256':hashlib.sha256((root/src).read_bytes()).hexdigest()} for src,target in sorted(sources.items(),key=lambda kv:kv[1])]
    status=_git(root,'status','--porcelain','--untracked-files=all')
    return {'format':'schoolvault-export-provenance/1','generator':'scripts/prepare_managed_beta.py',
            'source_commit':_git(root,'rev-parse','--verify','HEAD^{commit}'),'source_tree':_git(root,'rev-parse','--verify','HEAD^{tree}'),
            'source_dirty':status is None or status!='','files':files,'manifest_sha256':manifest_digest(files)}

def prepare(root=ROOT, destination=None, archive_path=None):
    sources=source_map(root)
    dest=Path(destination) if destination is not None else root/'service/managed-beta-source'
    # Replace only the source files we own. Never recursively delete an export directory.
    dest.mkdir(parents=True,exist_ok=True)
    if any(p.is_symlink() for p in dest.rglob('*')):raise ValueError('Export must not contain symlinks')
    expected=set(sources.values())|{'RELEASE-STATUS.json',PROVENANCE}
    unexpected=[str(p.relative_to(dest)) for p in dest.rglob('*') if p.is_file() and str(p.relative_to(dest)) not in expected]
    if unexpected:raise ValueError('Export directory contains unexpected files; use a fresh output directory')
    for src,target in sources.items():
        p=dest/target;p.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(root/src,p)
    manifest={'deployment_ready':False,'architecture':'separate Render web, managed Postgres, private disk',
              'fixed_baseline_usd_monthly':14.55,'paid_provisioning_authorized':False,'authorization_date':None,'budget_revision_date':'2026-10-01',
              'additional_spending_authorized':False,'windows_distribution':'free individual Microsoft Store registration and Store-signed AppX package',
              'owner_adapters_included':False,'secrets_included':False,
              'required_migrations':sorted(path for path in sources.values() if path.startswith('deploy/migrations/') and path.endswith('.sql')),
              'experimental_features':{
                  'SCHOOL_BETA_DEVICE_CONTENT':{'default':'off','requires':'retained-original native Companion, supported-format/semantic coverage, quota and recovery qualification; keep metadata readers during rollback'},
                  'SCHOOL_BETA_SOURCE_READING':{'default':'off','requires':'explicit flag plus AI enabled and separate semantic/resource qualification'},
                  'SCHOOL_BETA_CLASS_CAPTURE':{'default':'off','requires':'explicit flag and device/recovery qualification'},
                  'SCHOOL_BETA_CLASS_TRANSCRIPTION':{'default':'off','requires':'capture flag, explicit flag, pinned speech digest and speech qualification'},
                  'SCHOOL_BETA_CLASS_CORNELL':{'default':'off','requires':'capture and AI flags, explicit flag and semantic qualification'},
                  'SCHOOL_BETA_CLASS_ACTIONS':{'default':'off','requires':'capture flag, explicit flag and class-action qualification'}},
              'gates_remaining':['migrations through 023 and verified compatible web/worker cutover','private admissions key and admin SMTP configured; live approval/login/tenant separation checks','current unchanged full AI quality gate and student continuity/planning journeys','experimental source reading, class speech/notes/actions remain disabled until individually qualified','real student Moodle collection','verified publisher signature and protected Windows install',
                                 'full Moodle files/deadlines/receipts/grades coverage','physical Android install',
                                 'file backup recovery and production capacity'],
              'files':[{'path':target,'sha256':hashlib.sha256((root/src).read_bytes()).hexdigest()} for src,target in sorted(sources.items())]}
    (dest/'RELEASE-STATUS.json').write_text(json.dumps(manifest,indent=2)+'\n')
    # Provenance for scripts/predeploy_gate.py: source commit, tree and per-file hashes.
    (dest/PROVENANCE).write_text(json.dumps(provenance(root,sources),indent=2)+'\n')
    archive=Path(archive_path) if archive_path is not None else root/'service/managed-beta-source-review.zip'
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
        for target in sorted(expected):z.write(dest/target,target)
    archive.chmod(0o600)
    print(json.dumps({'source_directory':str(dest),'files':len(sources),'deployment_ready':False,'uploaded':False}))
    return dest,manifest

if __name__=='__main__':prepare()
