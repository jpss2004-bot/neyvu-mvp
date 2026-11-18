// Store packaging uses the pinned stable AppX target. No paid signing provider.
const base=require('./package.json').build;
function createStoreConfig(env){
 const identity=env.SCHOOL_STORE_IDENTITY_NAME;
 const publisher=env.SCHOOL_STORE_PUBLISHER;
 const display=env.SCHOOL_STORE_PUBLISHER_DISPLAY_NAME;
 if(typeof identity!=='string'||!/^[A-Za-z0-9.-]{3,50}$/.test(identity))throw Error('Copy Package/Identity/Name from the Neyvu product identity in Partner Center.');
 if(typeof publisher!=='string'||!/^CN=\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i.test(publisher))throw Error('Copy the exact Package/Identity/Publisher value from Partner Center.');
 if(typeof display!=='string'||!display.trim()||display.length>256||/[\r\n\0]/.test(display))throw Error('Copy the publisher display name from Partner Center.');
 const escaped=display.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
 return {...base,win:{...base.win,target:['appx'],artifactName:'Neyvu-${version}-${arch}.${ext}'},appx:{applicationId:'SchoolVaultCompanion',identityName:identity,publisher,publisherDisplayName:escaped,displayName:'Neyvu Companion',backgroundColor:'#263b31',capabilities:['runFullTrust','internetClient'],addAutoLaunchExtension:false,minVersion:'10.0.22000.0',maxVersionTested:'10.0.26100.0',languages:['en-US']}};
}
// Requiring the helper for tests does not construct a fake publisher identity.
module.exports=createStoreConfig;
