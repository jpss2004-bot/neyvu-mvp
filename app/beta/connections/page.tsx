import type {Metadata} from 'next';
import Connections from './connections';
import './connections.css';
// The page is a client shell (it ships in the static frontend export). The API
// enforces the NEYVU_CONNECTIONS_PAGE flag and sign-in, and the shell shows its answer.
export const metadata:Metadata={title:'Connections · Neyvu',robots:{index:false}};
export default function ConnectionsPage(){return <main className="nu-connections-page"><Connections/></main>;}
