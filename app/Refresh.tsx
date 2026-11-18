'use client';
import {useEffect, useTransition} from 'react';
import {useRouter} from 'next/navigation';
export default function Refresh() {
  const router=useRouter(); const [pending,start]=useTransition();
  useEffect(()=>{const timer=setInterval(()=>router.refresh(),60000);return ()=>clearInterval(timer);},[router]);
  return <button onClick={()=>start(()=>router.refresh())} disabled={pending}>{pending?'Reading…':'Refresh saved evidence ↻'}</button>;
}
