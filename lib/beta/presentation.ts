export type PresentationPreferences = {
 appearance:'black'|'light'|'system';
 text:'normal'|'large'|'larger';
 motion:'system'|'reduce'|'full';
 contrast:'standard'|'high';
};
export const presentationDefaults:PresentationPreferences={appearance:'system',text:'normal',motion:'system',contrast:'standard'};
export function readPresentation(appearance:string|null,stored:string|null):PresentationPreferences {
 let value:Partial<PresentationPreferences>={};
 try {if(stored&&stored.length<1024){const parsed=JSON.parse(stored);if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))value=parsed;}} catch {}
 return {
  appearance:appearance==='black'||appearance==='light'?appearance:'system',
  text:value.text==='large'||value.text==='larger'?value.text:'normal',
  motion:value.motion==='reduce'||value.motion==='full'?value.motion:'system',
  contrast:value.contrast==='high'?'high':'standard',
 };
}
