import {PRODUCT_NAME,SYMBOL} from '../lib/brand';
export default function Loading(){return <main className="workspace-loading"><img src={SYMBOL} alt="" width={28} height={28}/><p role="status">Opening {PRODUCT_NAME}…</p></main>;}
