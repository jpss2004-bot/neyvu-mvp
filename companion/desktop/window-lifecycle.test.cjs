const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {createStatusEmitter,installCompanionShutdown}=require('./window-lifecycle.cjs');

class App extends EventEmitter{
 constructor(){super();this.exits=0;}
 quit(){const event={prevented:false,preventDefault(){this.prevented=true;}};this.emit('before-quit',event);if(!event.prevented){this.exits++;this.emit('will-quit');}}
}
function barrier(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}

test('status reaches a live renderer and late browser-close events cannot use destroyed objects',()=>{
 const sent=[];let win={isDestroyed:()=>false,webContents:{isDestroyed:()=>false,send:(...args)=>sent.push(args)}};
 const emit=createStatusEmitter(()=>win),status={stage:'resume',account:'sample'};
 emit(status);assert.deepEqual(sent,[['status',status]]);
 win={isDestroyed:()=>true,get webContents(){throw Error('Destroyed window accessed');}};
 assert.doesNotThrow(()=>emit({stage:'resume'}));
 win={isDestroyed:()=>false,webContents:{isDestroyed:()=>true,send:()=>{throw Error('Destroyed renderer accessed');}}};
 assert.doesNotThrow(()=>emit({stage:'resume'}));win=null;assert.doesNotThrow(()=>emit({stage:'resume'}));assert.equal(sent.length,1);
});

test('unexpected send failures on a live window remain observable',()=>{
 const emit=createStatusEmitter(()=>({isDestroyed:()=>false,webContents:{isDestroyed:()=>false,send:()=>{throw Error('live failure');}}}));
 assert.throws(()=>emit({}),/live failure/);
});

test('normal application quit waits for browser closure even without window-all-closed',async()=>{
 const app=new App(),close=barrier(),order=[];
 const shutdown=installCompanionShutdown(app,{getHandoff:()=>({close:()=>order.push('handoff')}),getEngine:()=>({pause:async()=>{order.push('closing');await close.promise;order.push('closed');}})});
 app.on('will-quit',()=>order.push('exit'));app.quit();await Promise.resolve();
 assert.equal(app.exits,0);assert.deepEqual(order,['handoff','closing']);close.resolve();await shutdown.whenClosing();assert.deepEqual(order,['handoff','closing','closed','exit']);
});

test('repeated quit and window-close requests coalesce while browser cleanup is pending',async()=>{
 const app=new App(),close=barrier();let pauses=0,handoffs=0;
 const shutdown=installCompanionShutdown(app,{getHandoff:()=>({close:()=>handoffs++}),getEngine:()=>({pause:async()=>{pauses++;await close.promise;}})});
 app.quit();app.quit();app.emit('window-all-closed');await Promise.resolve();app.quit();assert.equal(app.exits,0);assert.equal(pauses,1);assert.equal(handoffs,1);
 close.resolve();await shutdown.whenClosing();assert.equal(app.exits,1);
});

test('closing the last native window also runs browser cleanup before exit',async()=>{
 const app=new App(),order=[];
 const shutdown=installCompanionShutdown(app,{getHandoff:()=>null,getEngine:()=>({pause:async()=>order.push('browser closed')})});
 app.on('will-quit',()=>order.push('exit'));app.emit('window-all-closed');await shutdown.whenClosing();assert.deepEqual(order,['browser closed','exit']);
});

test('browser-close status after native window destruction reproduces the original race without crashing',async()=>{
 const app=new App();let sends=0;const win={isDestroyed:()=>true,get webContents(){throw Error('Object has been destroyed');}};
 const emit=createStatusEmitter(()=>win);
 const shutdown=installCompanionShutdown(app,{getHandoff:()=>null,getEngine:()=>({pause:async()=>{emit({stage:'resume'});sends++;}})});
 app.quit();await shutdown.whenClosing();assert.equal(sends,1);assert.equal(app.exits,1);
});

test('handoff failure still closes the browser and does not disclose exception details',async()=>{
 const app=new App(),warnings=[];let pauses=0;
 const shutdown=installCompanionShutdown(app,{getHandoff:()=>({close:()=>{throw Error('private sign-in token');}}),getEngine:()=>({pause:async()=>pauses++}),warn:m=>warnings.push(m)});
 app.quit();await shutdown.whenClosing();assert.equal(pauses,1);assert.equal(app.exits,1);assert.equal(warnings.length,1);assert.doesNotMatch(warnings.join(),/private sign-in token/);
});

test('browser close rejection is handled, and startup without an engine can quit normally',async()=>{
 const app=new App(),warnings=[];
 const shutdown=installCompanionShutdown(app,{getHandoff:()=>undefined,getEngine:()=>({pause:async()=>{throw Error('private profile path');}}),warn:m=>warnings.push(m)});
 app.quit();await shutdown.whenClosing();assert.equal(app.exits,1);assert.equal(warnings.length,1);assert.doesNotMatch(warnings.join(),/private profile path/);
 const early=new App(),startup=installCompanionShutdown(early,{getHandoff:()=>undefined,getEngine:()=>undefined});early.quit();await startup.whenClosing();assert.equal(early.exits,1);
});
