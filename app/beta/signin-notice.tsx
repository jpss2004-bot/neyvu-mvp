import {signInNotice} from '../../lib/beta/signin-recovery';
import {translator} from '../../lib/beta/i18n';
import type {Language} from '../../lib/beta/language';
export default function SignInNotice({code,language}:{code:unknown;language:Language}){
 const notice=signInNotice(code),ui=translator(language);
 return <div role="alert" className="beta-alert"><p>{ui(notice.message)}</p>{notice.action?<p><a href={notice.action.href}>{ui(notice.action.label)}</a></p>:null}</div>;
}
