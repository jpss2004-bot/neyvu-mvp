import 'server-only';
import {headers} from 'next/headers';
import {supportedLanguage} from './language';
import {translator} from './i18n';
export async function serverI18n(){const language=supportedLanguage((await headers()).get('x-neyvu-language'))||'en';return {language,t:translator(language)};}
