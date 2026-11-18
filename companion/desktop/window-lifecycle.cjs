// Browser shutdown may report status after the native window has gone away.
function createStatusEmitter(getWindow){
 return value=>{
  const win=getWindow();
  if(!win||win.isDestroyed()||win.webContents.isDestroyed())return;
  win.webContents.send('status',value);
 };
}

// Cmd+Q does not emit window-all-closed. Hold before-quit until the isolated
// Moodle browser closes, and coalesce repeated quit requests during cleanup.
function installCompanionShutdown(app,{getHandoff,getEngine,warn=message=>console.warn(message)}){
 let complete=false,pending;
 app.on('before-quit',event=>{
  if(complete)return;
  event.preventDefault();
  if(pending)return;
  pending=Promise.resolve().then(async()=>{
   try{getHandoff()?.close();}catch{warn('The account connection window could not finish closing.');}
   try{await getEngine()?.pause();}catch{warn('The Moodle browser could not finish closing normally.');}
   finally{complete=true;app.quit();}
  });
 });
 app.on('window-all-closed',()=>app.quit());
 return {whenClosing:()=>pending};
}
module.exports={createStatusEmitter,installCompanionShutdown};
