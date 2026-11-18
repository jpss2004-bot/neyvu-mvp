import type {Metadata} from 'next';
import {serverI18n} from '../../../../lib/beta/server-i18n';
import {termsSections} from '../../../../lib/beta/pilot-policy';
import {PublicDocument} from '../public-document';
export async function generateMetadata():Promise<Metadata>{const {language}=await serverI18n();return {title:language==='es'?'Términos y condiciones | Neyvu':'Terms and conditions | Neyvu',description:language==='es'?'Acceso, uso responsable, materiales y límites de Neyvu.':'Access, responsible use, your materials and Neyvu’s limits.'};}
export default async function TermsPage(){const {language}=await serverI18n();return <PublicDocument kind="terms" language={language} sections={termsSections}/>;}
