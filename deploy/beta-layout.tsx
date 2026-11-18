import type {Metadata} from 'next';
import {PRODUCT_NAME,BRAND_ICONS} from '../lib/brand';
import {serverI18n} from '../lib/beta/server-i18n';
export const metadata:Metadata={title:PRODUCT_NAME,description:'Course materials, notes, planning and AI answers with source links.',manifest:'/beta/manifest.webmanifest',icons:BRAND_ICONS,robots:{index:false,follow:false},appleWebApp:{capable:true,title:PRODUCT_NAME,statusBarStyle:'default'}};
export default async function Layout({children}:{children:React.ReactNode}){const {language}=await serverI18n();return <html lang={language}><body style={{margin:0}}>{children}</body></html>;}
