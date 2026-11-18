# SchoolVault Companion for Windows

Requires Windows 11 and Microsoft Edge. Your Android phone uses the same Google account at https://neyvu-app.example.com/beta.

1. Extract the entire ZIP to a folder. Open **Start SchoolVault.cmd**.
2. In SchoolVault, sign in with Google and choose **Connect Moodle**. Create a connection code and paste it in the companion window within ten minutes.
3. Sign in to your own Acadia Moodle account in the separate Edge window. Confirm the displayed Moodle identity. No Moodle password is entered in SchoolVault.
4. Leave the companion window open for updates every twenty minutes. Closing it or sleeping the laptop pauses updates. If Moodle signs out, sign in again and reopen the companion.

The companion keeps its dedicated browser and Windows-account-encrypted connection token/session cookies in `%LOCALAPPDATA%\SchoolVault Companion`. It does not read your usual Edge/Chrome profiles. Cookies and passwords are not uploaded. Read-only visible course and activity text is uploaded to your private vault; it never submits assignments, changes Moodle or sends messages.

This initial collector covers visible course/catalog and supported activity pages. It does not yet capture original PDFs, external videos, deeper forum/book pages, released grades, verified receipts or calendar deadlines. Coverage gaps are retained with each page. New and changed text gets a source version; unchanged pages update their last-check timestamp. Absence of an item is not interpreted as deletion or submission.

To stop cloud access, choose **Disconnect** under Moodle in SchoolVault. Close the companion and delete its local SchoolVault Companion folder to remove this dedicated profile and saved credentials. Revocation preserves previously saved vault material. Connection codes are private, single-use and expire in ten minutes; laptop grants expire after thirty days.

No administrator access, Notion account or Tailscale setup is needed. This package is not code-signed. If Windows or your organization blocks it, report the exact message; do not disable Windows security or bypass organization policy.
