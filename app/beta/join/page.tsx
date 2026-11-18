import type {Metadata,Viewport} from 'next';
import {pageCapabilities,pageOrigin} from '../../../lib/beta/page-data';
import {unavailableCapabilities} from '../../../lib/beta/page-contract';
import {ConstellationContent} from './constellation-content';
import {ConstellationExperience} from './constellation-experience';
import './constellation.css';
import './constellation-daylight.css';
import './context-story.css';
import '../design-system.css';
import {PRODUCT_NAME,BRAND_ICONS} from '../../../lib/brand';

import {landingCopy,landingPath,landingStructuredData,serializeStructuredData} from '../../../lib/beta/public-site';
import {serverI18n} from '../../../lib/beta/server-i18n';
export const dynamic='force-dynamic';
export const viewport:Viewport={themeColor:'#f6f8fc',colorScheme:'light'};
const publicBase=(()=>{try{return new URL(pageOrigin());}catch{return new URL('http://127.0.0.1:3220');}})();
export async function generateMetadata():Promise<Metadata>{
 const {language}=await serverI18n();const {title,description}=landingCopy(language);const path=landingPath(language);
 const socialImage=language==='es'?'/brand/neyvu-social-es.png?v=context':'/brand/neyvu-social.png?v=context';
 return {
 metadataBase:publicBase,
 title,
 description,
 robots:{index:true,follow:true},
 alternates:{canonical:path,languages:{en:landingPath('en'),es:landingPath('es'),'x-default':landingPath('en')}},
 icons:BRAND_ICONS,
 manifest:'/beta/manifest.webmanifest',
 appleWebApp:{capable:true,title:PRODUCT_NAME,statusBarStyle:'default'},
 openGraph:{type:'website',url:path,locale:language==='es'?'es_MX':'en_CA',alternateLocale:[language==='es'?'en_CA':'es_MX'],siteName:PRODUCT_NAME,title,description,images:[{url:socialImage,width:1200,height:630,alt:title}]},
 twitter:{card:'summary_large_image',title,description,images:[socialImage]}
};}
export default async function JoinPage(){
 const {language}=await serverI18n();const capabilities=await pageCapabilities().catch(()=>unavailableCapabilities);
 return <><script id="neyvu-public-structured-data" type="application/ld+json" dangerouslySetInnerHTML={{__html:serializeStructuredData(landingStructuredData(publicBase.origin,language))}}/><ConstellationExperience><ConstellationContent ready={capabilities.accessReady}/></ConstellationExperience></>;
}
