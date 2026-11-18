import type {Metadata} from 'next';
import {PRODUCT_NAME,BRAND_ICONS} from '../../lib/brand';
import {serverI18n} from '../../lib/beta/server-i18n';
export const metadata:Metadata={title:PRODUCT_NAME+' hosting preview',icons:BRAND_ICONS,robots:{index:false,follow:false}};
export default async function Layout({children}:{children:React.ReactNode}){
 const {language}=await serverI18n();return <html lang={language}><body style={{margin:0}}><aside style={{position:'fixed',bottom:12,left:12,right:12,zIndex:2147483647,padding:'10px 16px',borderRadius:10,background:'#173c36',color:'#fff',font:'13px/1.5 system-ui',boxShadow:'0 4px 30px #0003'}}>{language==='es'?'Vista previa de alojamiento. El acceso y las solicitudes están desactivados. ':'Hosting preview. Sign-in and join requests are disabled. '}<a style={{color:'#c9f8d8'}} href="https://neyvu-app.example.com/beta/join">{language==='es'?'Ir a Neyvu':'Open live Neyvu'} ↗</a></aside>{children}</body></html>;
}
