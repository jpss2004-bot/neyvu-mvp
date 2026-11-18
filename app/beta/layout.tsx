import ApplicationAppearance from './application-appearance';
import './utility-theme.css';
import {LanguageProvider} from './language';
import {serverI18n} from '../../lib/beta/server-i18n';
import './language.css';
export default async function BetaLanguageLayout({children}:{children:React.ReactNode}){const {language}=await serverI18n();return <LanguageProvider initialLanguage={language}><ApplicationAppearance/>{children}</LanguageProvider>;}
