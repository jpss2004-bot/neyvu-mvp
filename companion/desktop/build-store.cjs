const {build,Platform,Arch}=require('electron-builder');
const createStoreConfig=require('./store-config.cjs');
const identity=require('./store-identity.json');
(async()=>{
 const config=createStoreConfig({
  SCHOOL_STORE_IDENTITY_NAME:identity.identityName,
  SCHOOL_STORE_PUBLISHER:identity.publisher,
  SCHOOL_STORE_PUBLISHER_DISPLAY_NAME:identity.publisherDisplayName
 });
 if(process.platform!=='win32')throw Error('Store packaging requires a Windows build environment. Verify a free allowance before using hosted builds.');
 if(process.env.CSC_LINK||process.env.WIN_CSC_LINK)throw Error('Remove direct-signing credentials from the Store build environment. Microsoft signs this package after certification.');
 process.env.CSC_IDENTITY_AUTO_DISCOVERY='false';
 // A Store upload needs no CA signing subscription. Never install the unsigned package as a trusted release.
 await build({targets:Platform.WINDOWS.createTarget('appx',Arch.x64),config,publish:'never'});
})().catch(error=>{console.error(error.message);process.exitCode=1;});
