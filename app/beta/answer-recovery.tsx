'use client';
import {useI18n} from './language';

export default function AnswerRecovery({onMaterials,onFollowup,canPrepare}:{onMaterials:()=>void;onFollowup:()=>void;canPrepare:boolean}){
 const {t}=useI18n();
 return <div role="group" className="nu-answer-recovery" aria-label={t('Example needs a source')}>
  <strong>{t('Example needs a source')}</strong>
  <p>{t('Your question and attached material are kept. Review the original or prepare a follow-up that separates general explanation from source evidence.')}</p>
  <div><button type="button" onClick={onMaterials}>{t('Review available material')}</button><button type="button" onClick={onFollowup} disabled={!canPrepare}>{t('Prepare a clearer follow-up')}</button></div>
  {!canPrepare&&<small>{t('Your current draft is kept. Finish or save it before preparing another question.')}</small>}
 </div>;
}
