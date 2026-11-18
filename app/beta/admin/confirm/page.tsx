import {serverI18n} from "../../../../lib/beta/server-i18n";
import {AdminConfirm} from '../admin-ui';
import '../../join/join.css';
export const dynamic='force-dynamic';
export default async function ConfirmPage(){
 const {t:ui}=await serverI18n();return <main className="sv-admin-page"><div className="sv-admin-shell"><a className="sv-name" href="/beta/join">{ui("Neyvu")}</a><AdminConfirm/></div></main>;}
