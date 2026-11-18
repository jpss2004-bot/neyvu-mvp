import {creatorName,creatorPortfolio,supportEmail} from '../../lib/beta/public-identity';
import {languageHref,type Language} from '../../lib/beta/language';
import './public-footer.css';
export function PublicFooter({language}:{language:Language}){const es=language==='es';return <footer className="neyvu-public-footer"><nav aria-label={es?'Información de Neyvu':'Neyvu information'}><a href={languageHref('/beta/join/privacy',language)}>{es?'Privacidad':'Privacy'}</a><a href={languageHref('/beta/join/terms',language)}>{es?'Términos y condiciones':'Terms and conditions'}</a><a href={'mailto:'+supportEmail}>{es?'Contacto':'Contact'}</a></nav><p>{es?'Creado por':'Built by'} <a href={creatorPortfolio} rel="noopener noreferrer">{creatorName}</a></p></footer>;}
