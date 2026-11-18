import type { Metadata } from 'next';
import './globals.css';
import './pilot.css';
import './system.css';
import 'katex/dist/katex.min.css';
export const metadata:Metadata = {title:'School · Acadia',description:'Your Acadia course assistant and notebook',manifest:'/manifest.webmanifest',icons:{icon:'/icon-192.png',apple:'/icon-192.png'},appleWebApp:{capable:true,title:'School',statusBarStyle:'default'},robots:{index:false,follow:false}};
export default function Layout({children}:{children:React.ReactNode}) { return <html lang="en"><body>{children}</body></html>; }
