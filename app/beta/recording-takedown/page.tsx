import TakedownForm from './form';
export const metadata={title:'Ask for a class recording to be removed · Neyvu'};
export default function RecordingTakedown(){
 return <main style={{maxWidth:620,margin:'48px auto',padding:'0 16px',font:'16px/1.5 system-ui'}}>
  <h1>Ask for a class recording to be removed</h1>
  <p>Neyvu learners may record a class only with the instructor’s prior permission or a registered accommodation, for personal study. If you are the instructor, a classmate or the institution and want a recording stopped or removed, tell us here. You do not need an account.</p>
  <p>We acknowledge within 2 business days and act on instructor and institution requests promptly, removing the audio and hiding the recording while we review. See the lecture recording consent policy for details.</p>
  <TakedownForm/>
 </main>;
}
