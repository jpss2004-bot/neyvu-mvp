import {LanguageSelect} from '../language';
import type {Language} from '../../../lib/beta/language';
import {creatorName,creatorPortfolio,supportEmail} from '../../../lib/beta/public-identity';
import {policyDate,privacyDate,policyText,type PolicySection} from '../../../lib/beta/pilot-policy';
import {WORDMARK,WORDMARK_LIGHT} from '../../../lib/brand';
import './public-document.css';

export function PublicDocument({kind,language,sections}:{kind:'privacy'|'terms';language:Language;sections:PolicySection[]}){
 const es=language==='es',title=kind==='privacy'?(es?'Tu información en Neyvu.':'Your information in Neyvu.'):(es?'Términos y condiciones.':'Terms and conditions.');
 return <div className="public-document"><header><a href="/beta/join" aria-label="Neyvu"><img className="nu-legal-wordmark-dark" src={WORDMARK} width="138" height="35" alt="Neyvu"/><img className="nu-legal-wordmark-light" src={WORDMARK_LIGHT} width="138" height="35" alt="Neyvu"/></a><nav aria-label={es?'Navegación':'Navigation'}><a href="/beta/start#devices">{es?'Configuración':'Setup'}</a><LanguageSelect compact/></nav></header>
  <main><p className="public-document-back"><a href="/beta/join">{es?'Volver a Neyvu':'Back to Neyvu'}</a></p><h1>{title}</h1><p className="public-document-date">{es?'Actualizado:':'Updated:'} {(kind==='privacy'?privacyDate:policyDate)[language]}</p>
   <p className="public-document-intro">{kind==='privacy'?(es?'Qué guardamos, cómo se usa y qué puedes controlar.':'What we save, how it is used and what you can control.'):(es?'Qué ofrece Neyvu y cómo usarlo con responsabilidad.':'What Neyvu offers and how to use it responsibly.')}</p>
   <nav className="public-document-index" aria-label={es?'En esta página':'On this page'}>{sections.map(s=><a key={s.id} href={'#'+s.id}>{policyText(s.title,language)}</a>)}</nav>
   {sections.map(s=><section id={s.id} key={s.id}><h2>{policyText(s.title,language)}</h2>{s.paragraphs.map((text,i)=><p key={i}>{policyText(text,language)}</p>)}</section>)}
   <aside className="public-document-contact"><h2>{es?'Habla con el creador':'Talk to the builder'}</h2><p><a href={'mailto:'+supportEmail}>{supportEmail}</a></p><p>{es?'Creado por':'Built by'} <a href={creatorPortfolio} rel="noopener noreferrer">{creatorName}</a></p></aside>
  </main><footer><a href="/beta/join/privacy" aria-current={kind==='privacy'?'page':undefined}>{es?'Privacidad':'Privacy'}</a><a href="/beta/join/terms" aria-current={kind==='terms'?'page':undefined}>{es?'Términos y condiciones':'Terms and conditions'}</a><a href="/beta/join">Neyvu</a></footer>
 </div>;
}
