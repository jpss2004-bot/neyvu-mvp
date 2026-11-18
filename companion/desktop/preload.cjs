const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('schoolvault',{
 action:(command,payload)=>ipcRenderer.invoke('action',command,payload),
 status:()=>ipcRenderer.invoke('status'),
 onStatus:callback=>ipcRenderer.on('status',(_event,value)=>callback(value))
});
