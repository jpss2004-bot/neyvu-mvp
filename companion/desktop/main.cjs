const {app,BrowserWindow,ipcMain,shell,safeStorage,dialog,Menu}=require('electron');
const path=require('node:path');const fs=require('node:fs/promises');const {pathToFileURL}=require('node:url');
const {createStatusEmitter,installCompanionShutdown}=require('./window-lifecycle.cjs');
app.setAppUserModelId('app.schoolvault.companion');
if(!app.requestSingleInstanceLock()){app.quit();}else{
 let win,engine,handoff;
 installCompanionShutdown(app,{getHandoff:()=>handoff,getEngine:()=>engine});
 app.on('second-instance',()=>{win?.show();win?.focus();});
 app.whenReady().then(async()=>{
  // Keep the existing internal app name: macOS saved credentials use it.
  // Brand the visible menu and About panel without changing that key identity.
  if(process.platform==='darwin'){
   app.setAboutPanelOptions({applicationName:'Neyvu Companion',applicationVersion:app.getVersion()});
   Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'Neyvu Companion',submenu:[{role:'about',label:'About Neyvu Companion'},{type:'separator'},{role:'services'},{type:'separator'},{role:'hide',label:'Hide Neyvu Companion'},{role:'hideOthers'},{role:'unhide'},{type:'separator'},{role:'quit',label:'Quit Neyvu Companion'}]},{role:'editMenu'},{role:'viewMenu'},{role:'windowMenu'}]));
  }
  const root=path.join(app.getPath('appData'),'SchoolVault Companion Desktop');await fs.mkdir(root,{recursive:true});
  win=new BrowserWindow({width:760,height:700,minWidth:600,minHeight:580,show:false,backgroundColor:'#000000',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  win.on('closed',()=>{win=null;});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',e=>e.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  const {Companion}=await import(pathToFileURL(path.join(__dirname,'engine.mjs')));
  const {createHandoff,pairWithStatus}=await import(pathToFileURL(path.join(__dirname,'handoff.mjs')));
  const {createConnectionStorage}=require('./connection-storage.cjs');
  const {load,save}=createConnectionStorage({root,safeStorage});
  const {createSecureContentJournal}=await import(pathToFileURL(path.join(__dirname,'content-journal.mjs')));
  const {createPdfContentCollector}=await import(pathToFileURL(path.join(__dirname,'content-collector.mjs')));
  const {loadPackagedNativeReader}=await import(pathToFileURL(path.join(__dirname,'native-package.mjs')));
  const {createOriginalRecovery}=await import(pathToFileURL(path.join(__dirname,'original-recovery.mjs')));
  const journal=createSecureContentJournal({root:path.join(root,'retained-pdfs'),safeStorage});
  const recovery=createOriginalRecovery({journal,chooseDestination:async({defaultName})=>{const result=await dialog.showSaveDialog(win,{title:'Save a retained original PDF',defaultPath:defaultName,buttonLabel:'Save copy',filters:[{name:'PDF original',extensions:['pdf']}],properties:['createDirectory','showOverwriteConfirmation']});return result.canceled?null:result.filePath;},reveal:file=>shell.showItemInFolder(file)});
  let recoveryBusy=false;
  const {RELEASE}=await import(pathToFileURL(path.join(__dirname,'protocol.mjs')));
  const emitStatus=createStatusEmitter(()=>win);
  engine=new Companion({root,load,save,clearProfile:()=>fs.rm(path.join(root,'moodle-browser'),{recursive:true,force:true}),emit:value=>emitStatus({...value,release:RELEASE})});
  const {verifyDelivery,createStartupCheck}=await import(pathToFileURL(path.join(__dirname,'preflight.mjs')));let filesReady=false,setupReady=false;
  const preflight=createStartupCheck({verify:async()=>{filesReady=false;setupReady=false;engine.update({stage:'checking',title:'Checking this copy…',detail:'Checking copied files, your Moodle browser and Neyvu.'});if(app.isPackaged)await verifyDelivery(path.dirname(process.resourcesPath),__dirname);engine.deviceContent=null;const native=await loadPackagedNativeReader({appRoot:__dirname,resourcesRoot:process.resourcesPath});if(native)engine.deviceContent=createPdfContentCollector({journal,readPdf:native.readPdf});filesReady=true;},load:()=>engine.init(),check:async()=>{setupReady=await engine.preflight();return setupReady;}});
  const status=()=>({...engine.status,release:RELEASE});
  const failure=error=>{engine.fail(error);if(error.savedConnection)engine.update({stage:'restore',title:'Your saved connection needs attention.',diagnostics:{release:RELEASE,step:'Protected connection',code:error.connectionStorageCode||'read_failed',saved_copy_preserved:true}});else if(!filesReady||!setupReady)engine.update({stage:'preflight'});};
  const trusted=event=>win&&!win.isDestroyed()&&!win.webContents.isDestroyed()&&event.sender===win.webContents&&event.senderFrame===win.webContents.mainFrame&&event.senderFrame?.url===pathToFileURL(path.join(__dirname,'ui/index.html')).href;
  ipcMain.handle('status',event=>{if(!trusted(event))throw Error('Unavailable');return status();});
  ipcMain.handle('action',async(event,command,payload)=>{
   if(!trusted(event)||!['pair','moodle','check','confirm','courses','select','refresh','cancel-refresh','open','reset','preflight','originals','export-original'].includes(command))throw Error('Unavailable');
   try{
    if(recoveryBusy)throw Error('Finish the current original recovery first.');
    if(command==='preflight'){await preflight();return status();}
    if(!filesReady)throw Error('Complete the file check before connecting.');
    if(['originals','export-original'].includes(command)){
     if(engine.busy||engine.pairing){engine.update({retainedOriginalError:'Wait for the current refresh or connection step to finish before recovering originals.'});return status();}
     recoveryBusy=true;try{engine.update({retainedOriginalError:'',retainedOriginalMessage:''});if(command==='originals')engine.update({retainedOriginals:await recovery.list()});else{const result=await recovery.exportOriginal(payload);engine.update({retainedOriginalMessage:result.saved?'Verified copy saved: '+result.name+'. Your retained original is kept.': 'No copy saved. Your retained original is kept.',retainedOriginals:await recovery.list()});}}catch(error){engine.update({retainedOriginalError:error.message||'Original recovery could not finish. Retained originals are kept.'});}finally{recoveryBusy=false;}return status();
    }
    if(!setupReady&&!['reset','open'].includes(command))throw Error('Complete the setup checks before connecting.');
    if(command==='pair'){handoff?.close();handoff=await createHandoff(code=>pairWithStatus(engine,code),{origin:await engine.handoffOrigin()});engine.update({stage:'pairing',title:'Connect your Neyvu account.',detail:'Your browser will ask you to choose your Google account and confirm this laptop. Return here afterward.'});await shell.openExternal(handoff.url);}
    if(command==='moodle')await engine.openMoodle();if(command==='check')await engine.checkAccount();if(command==='confirm')await engine.confirm();
    if(command==='courses')await engine.prepareCourses(payload?.ids);if(command==='select')await engine.selectCourses(payload?.ids);
    if(command==='cancel-refresh')engine.cancelRefresh();
    // The engine selects continuation versus the ordinary refresh interval.
    if(command==='refresh')await engine.refresh();
    if(command==='open')await shell.openExternal(engine.web+'/beta');
    if(command==='reset'){handoff?.close();handoff=null;await engine.reset();const resetDetail=engine.status.detail;await preflight();engine.update({detail:resetDetail+' '+engine.status.detail});}
   }catch(e){failure(e);}return status();
  });
  await win.loadFile(path.join(__dirname,'ui/index.html'));
  if(!win||win.isDestroyed())return;
  win.show();try{const ready=await preflight();if(ready&&process.argv.includes('--resume-moodle'))await engine.resumeSavedConnection();}catch(e){failure(e);}
 });
}
