import type {Metadata} from 'next';
import {serverI18n} from '../../../../lib/beta/server-i18n';
import {privacySections} from '../../../../lib/beta/pilot-policy';
import {PublicDocument} from '../public-document';
export async function generateMetadata():Promise<Metadata>{const {language}=await serverI18n();return {title:language==='es'?'Privacidad | Neyvu':'Privacy | Neyvu',description:language==='es'?'Cómo Neyvu procesa tus materiales, preguntas y datos.':'How Neyvu handles your materials, questions and data.'};}
export default async function PrivacyPage(){const {language}=await serverI18n();return <PublicDocument kind="privacy" language={language} sections={privacySections}/>;}
