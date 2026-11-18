import {headers} from 'next/headers';
import {accountFor,privateHost} from '../lib/auth';
import {workspace} from '../lib/pilot';
import PilotClient from './components/PilotClient';
import PairDevice from './components/PairDevice';
export const dynamic='force-dynamic';
export default async function Home(){
 const host=(await headers()).get('host'),account=await accountFor(host);
 if(!account)return privateHost(host)&&!process.env.VERCEL?<PairDevice/>:<main className="pair-screen"><div className="pair-card"><h1>Private school workspace</h1><p>Open your paired private app address to access your courses.</p></div></main>;
 try{return <PilotClient initial={await workspace(account)}/>;}catch{return <main className="pair-screen"><div className="pair-card"><h1>Course evidence is unavailable</h1><p>Your saved notes are preserved. Reconnect to your school host and try again.</p><a className="button secondary" href="/">Try again</a></div></main>;}
}
