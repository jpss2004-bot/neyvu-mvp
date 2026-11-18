'use client';
import {useEffect,useState} from 'react';
export default function ChatPending({onStop}:{onStop:()=>void}) {
 const [seconds,setSeconds]=useState(0);
 useEffect(()=>{const start=Date.now();const timer=setInterval(()=>setSeconds(Math.floor((Date.now()-start)/1000)),1000);return()=>clearInterval(timer);},[]);
 const text=seconds>=60?'Taking longer than usual…':seconds>=12?'Still working on your answer…':'Working on your question…';
 return <div className="chat-pending"><div role="status"><span className="pending-indicator" aria-hidden="true"/><span>{text}</span></div>
   {seconds>=12?<p>You can keep reading or draft your next question.</p>:null}
   <button type="button" onClick={onStop}>Stop waiting</button>
 </div>;
}
