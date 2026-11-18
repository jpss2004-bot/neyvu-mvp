'use client';
import {useI18n} from "./language";
import './device-guide.css';

export default function DeviceGuide(){
 const {t:ui}=useI18n();
 return <section id="devices" className="beta-device-guide" aria-labelledby="beta-device-title">
  <h2 id="beta-device-title">{ui("Download and set up Neyvu.")}</h2>
  <p>{ui("Use the website for your vault, notes and conversations. Automatic Moodle updates need the Companion on a connected Mac or Windows laptop.")}</p>
  <div className="beta-device-list">
   <details open><summary><strong>{ui("Windows laptop")}</strong><span>{ui("Available from Microsoft Store · Windows 11 Intel/AMD")}</span></summary><div>
    <p><a className="beta-device-download" href="https://apps.microsoft.com/detail/9N0000000000" target="_blank" rel="noreferrer">{ui("Get Neyvu Companion from Microsoft Store")}</a></p>
    <p>{ui("Use the official Store listing for installation and updates. Windows 11 on an Intel or AMD x64 PC is supported; ARM Windows is not qualified. Find your system type in Settings → System → About.")}</p>
    <p>{ui("Check for updates in Microsoft Store → Library, then record the installed package version. Website and local reader updates are separate from Companion updates.")}</p>
    <h3>{ui("Already connected?")}</h3>
    <p>{ui("Let any current collection finish, then close Companion normally. Update your existing Store installation from Microsoft Store → Library, then reopen Companion using the same Windows account. Keep your saved connection and current course choices. Do not uninstall, reset or disconnect to perform an update.")}</p>
    <p>{ui("If you use an older USB or portable copy, ask the Neyvu owner to confirm the update path first. If your saved connection unexpectedly disappears, stop and report it before pairing again.")}</p>
    <h3>{ui("Check your Moodle refresh")}</h3>
    <p>{ui("Open the Companion’s Moodle window and sign in if asked. Review your saved account and current lectures plus separate labs, then refresh the selected courses. Keep Companion and Moodle open and the laptop awake. Productive batches continue automatically; the ordinary refresh runs twenty minutes after a batch cycle finishes.")}</p>
    <p>{ui("Check the last refresh attempt, next automatic refresh and named collection gaps. On the website, Refresh status only reads saved data. Compare a newly saved assignment instruction and a readable PDF with Moodle before relying on an answer.")}</p>
   </div></details>
   <details><summary><strong>{ui("iPhone or iPad")}</strong><span>{ui("Use the website")}</span></summary><div><p>{ui("Open Neyvu in Safari and sign in with your approved Google account. Your saved course materials are in the same vault you use on your laptop.")}</p><p>{ui("There is no iPhone or iPad Companion download. Connect Moodle from a supported laptop; leave its Companion open and the laptop awake for new material to arrive.")}</p></div></details>
   <details><summary><strong>{ui("Mac with Apple Silicon")}</strong><span>{ui("Website available · Companion pending")}</span></summary><div><p>{ui("Open the website in your browser. To identify your Mac, choose the Apple menu → About This Mac. A Chip named Apple M1, M2 or later means Apple Silicon. The prepared Companion requires macOS 13 or later.")}</p><p>{ui("The Apple Silicon Companion download is not ready yet. Its browser connection, package integrity and normal macOS installation must pass before it appears here.")}</p></div></details>
   <details><summary><strong>{ui("Mac with Intel")}</strong><span>{ui("Website available · Companion pending")}</span></summary><div><p>{ui("Open the website in your browser. Choose the Apple menu → About This Mac. A Processor named Intel means you need the Intel Mac package. The prepared Companion requires macOS 13 or later.")}</p><p>{ui("The Intel Companion download is not ready yet. You can use the website for saved material and notes.")}</p></div></details>

  </div>
  <p className="beta-device-next">{ui("After approval: sign in → connect your laptop → sign into Acadia Moodle → choose your current lectures and labs → review the import and any gaps. You do not need a Render or Vercel account.")}</p>
 </section>;
}
