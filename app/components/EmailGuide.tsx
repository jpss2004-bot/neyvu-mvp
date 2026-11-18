export default function EmailGuide() {
  return <section className="email-guide" aria-labelledby="email-guide-title">
    <div className="section-line"><h2 id="email-guide-title">University email through Gmail</h2><span className="status-chip">Optional · setup guide</span></div>
    <p>Forward university messages to your Gmail account. You can keep using courses and notebooks while you set this up.</p>
    <details>
      <summary>Show forwarding steps</summary>
      <ol>
        <li>Open your university mailbox in Outlook on the web.</li>
        <li>Open Settings → Mail → Forwarding (sometimes called Forwarding and IMAP).</li>
        <li>Enable forwarding, enter your Gmail address, keep a copy in your university mailbox, and save.</li>
        <li>Check Gmail for a new university message, including Spam. Forwarding is only confirmed when a message arrives.</li>
      </ol>
      <p>If forwarding is unavailable or rejected by Acadia, keep using Moodle and notes. You can manually forward a message to Gmail or import its text into a note.</p>
      <p>Google sign-in identifies your app account. Reading messages in Gmail requires a separate permission. This guide does not request or grant Gmail access.</p>
      <p>To reply from your university address, open the original mailbox. Forwarding alone does not give School permission to send university email.</p>
      <a href="https://support.microsoft.com/en-us/outlook/mail/turn-automatic-forwarding-on-or-off-in-outlook" target="_blank" rel="noreferrer">Official forwarding instructions</a>
    </details>
  </section>;
}
