import {PRODUCT_NAME,WORDMARK,SYMBOL_LIGHT} from '../../../lib/brand';
import RequestForm from './request-form';
import {WelcomePreview} from './welcome-preview';
import {CinematicStory} from './cinematic-story';

export function WelcomeContent({ready}:{ready:boolean}){
 return <div className="neyvu-welcome">
  <a className="nw-skip" href="#welcome-main">Skip to content</a>
  <header className="nw-header nc-header"><div className="nw-wrap nw-header-inner">
   <a href="#top" aria-label={`${PRODUCT_NAME}, back to top`}><img src={WORDMARK} width="142" height="36" alt={PRODUCT_NAME}/></a>
   <nav aria-label="Primary"><a href="#getting-started">Getting started</a><a href="/beta">Sign in</a><a className="nw-header-access" href="#request-access">Request access</a></nav>
  </div></header>
  <main id="welcome-main" tabIndex={-1}>
   <CinematicStory/>
   <section className="nw-wrap nc-conversation" aria-labelledby="conversation-title">
    <div className="nc-conversation-heading"><h2 id="conversation-title">One question.<br/>More context.</h2><p>Ask about your saved course material. Follow an idea back to the reading. Leave with a place to start.</p></div>
    <WelcomePreview/>
   </section>
   <section className="nw-wrap nw-benefits" aria-labelledby="benefits-title">
    <h2 id="benefits-title">Less searching.<br/>More understanding.</h2>
    <div className="nw-benefit-list">
     <article><h3>Start with what you have.</h3><p>Add notes, files or a folder of course material. Connect selected Moodle courses with Companion when you’re ready.</p></article>
     <article><h3>Keep the source in reach.</h3><p>Open supporting material from an answer. See what was saved, when it was refreshed, and where the reading has gaps.</p></article>
     <article><h3>Pick up where you left off.</h3><p>Keep your notes, saved conversations and personal plan together. Find material by its text and past chats by their titles.</p></article>
    </div>
   </section>
   <section className="nw-access" id="request-access" aria-labelledby="access-title" tabIndex={-1}>
    <div className="nw-wrap nw-access-grid">
     <div id="getting-started" className="nw-start">
      <img src={SYMBOL_LIGHT} width="48" height="48" alt=""/>
      <h2 id="access-title">Make room for<br/>your own courses.</h2>
      <p>Access is for Acadia students. Use the Google account you’ll sign in with; your personal Gmail works too.</p>
      <ol className="nw-steps">
       <li><strong>Request access.</strong><span>A person reviews each request.</span></li>
       <li><strong>Sign in after approval.</strong><span>Add a note or upload your materials.</span></li>
       <li><strong>Ask your first course question.</strong><span>For Moodle, ask for guided Companion setup.</span></li>
      </ol>
     </div>
     <div className="nw-form-surface"><h3>Request access</h3><p className="nw-form-intro">No account or Moodle connection is created until you’re approved and sign in.</p><RequestForm ready={ready}/></div>
    </div>
   </section>
   <section className="nw-wrap nw-questions" aria-labelledby="questions-title">
    <h2 id="questions-title">A few useful things to know.</h2>
    <div>
     <details><summary>Can I use it on my phone?</summary><p>Yes, the website works on your phone. Automatic Moodle collection needs Companion running on a connected computer. A downloadable phone app is a future goal.</p></details>
     <details><summary>How does Moodle stay up to date?</summary><p>You sign in to Moodle yourself in the Companion and choose your courses. Keep it running for updates. Neyvu shows saved-material times and collection gaps; check current official dates, requirements, receipts and grades in Moodle.</p></details>
     <details><summary>What can I upload?</summary><p>PDFs, Word documents, PowerPoint slides and plain-text or Markdown notes. You can select several files or a folder. Scans, images, equations and diagrams may need a readable text copy or review; keeping an original does not mean every part was understood.</p></details>
     <details><summary>Where does the AI run?</summary><p>Neyvu uses local AI processing on a computer run by the project. Your questions are not sent to ChatGPT or Claude. AI explanations can be wrong: open the sources, and follow your instructor’s AI rules. Neyvu never submits coursework for you.</p></details>
    </div>
   </section>
  </main>
  <footer className="nw-wrap nw-footer"><p>Built by an Acadia student.<br/>An independent project, not run by Acadia University.</p><a href="/beta/join/privacy">Privacy and your data</a><a href="/beta">Sign in</a></footer>
 </div>;
}
