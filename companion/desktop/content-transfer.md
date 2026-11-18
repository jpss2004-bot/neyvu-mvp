# Retained device PDF transfer

This is next-release source. The main process now enables the native collector only when an integrity-checked ASAR pin and its exact external helper are present; missing pins retain the legacy collector, and invalid pins fail setup. The published0.3.9 package is unchanged. Local candidate activation is not production commissioning: matching backend, native installations, trusted distribution and full coverage still need release acceptance.

The main process creates `createSecureContentJournal({root, safeStorage})` in an application-private folder outside `moodle-browser`, then `createPdfContentCollector({journal, readPdf})` and passes it as the engine's `deviceContent`. The application single-instance lock must remain the sole process writer. The module serializes instances inside that process; it is not a cross-process database. The reader receives original bytes and an optional abort signal, returning only `{extractor, pages}` for `preparePdfContent`.

The OS secure-storage wrapper refuses unavailable encryption and the Linux plaintext fallback. Each encrypted snapshot retains the original, exact first capture metadata, stable request/recovery IDs, packet and monotonically bound server session/receipt. No bearer token is stored in it: a hash binds the connection. Changes to connection, Moodle identity, course, reviewed course revision, origin or original bytes produce separate intents; earlier records remain. Same-intent retries reuse the persisted packet and capture time, without rerunning a reader. Failed reading retains the original before any begin operation.

Fresh files use the legacy binary path only when negotiation explicitly reports device ingestion disabled and no retained intent exists. A paused, failed, ambiguous or historical retained transfer never silently falls through. Network boundaries recheck the captured local connection/review; the backend separately rechecks current grants/course/version/quota. A final receipt must identify the current immutable source version to count as a saved current import. A historical receipt remains recoverable but requires review.

`recoverOriginal({recoveryHandle, sha256})` resolves the server's opaque handle locally even after disconnection. `key` is an optional faster local lookup, never a server path. Recovery does not change account bindings, contact a service, export a file or permit deletion. The local recovery screen opens the system Save dialog for an explicit destination, verifies a new copy and refuses existing filenames. It shows saved course/account labels where available; earlier records retain ID fallbacks. Renderer messages contain no original bytes or export paths. Reset preserves retained originals. No cleanup or eviction API exists.

Storage is bounded to 500 records and 256 MiB encrypted bytes. Replacement admission includes the current file plus its whole new temporary snapshot; no original/orphan is silently deleted for space. Unix storage is private (0700 folder, 0600 files), rejects links, syncs temporary bytes, atomically renames and syncs the directory. Windows power-loss/ACL/OS-storage behavior requires installed-device testing; the Node API has no portable Windows directory fsync guarantee. The sole application writer and correct user-private root are integration requirements.

Local checks cover failed readers/encryption/capacity, corrupted/link storage, exact original recovery in another Node process, saved intent across lost acknowledgements, account/review isolation, historical receipts and real optimized-backend HTTP restart with ingestion disabled. The HTTP diagnostic reuses saved 19-page extraction, preserves all partial flags and its known math OCR error, and uses disposable test encryption. It does not certify native readers, OS keychain/DPAPI behavior, complete PDF understanding or installed Windows/Mac delivery.


The local Mac reader source is `native-pdf.swift`, compiled only with the installed Apple SDK using `build-native-pdf.cjs arm64|x64 ABSOLUTE_NEW_OUTPUT`. This produces a hash-pinned, ad-hoc signed helper, not a trusted distributed Mac app. `createNativePdfReader({executable,artifactSHA256})` passes only stdin bytes to that pinned helper inside a network-denied sandbox, with bounded output/deadline and a minimal environment; it refuses changed/linked/writable helpers and waits for an interrupted child to close. No document URL, browser cookie or token enters the helper. The local qualification runs with network denied for parent and child.

The raw observation retains selectable text/line boxes and separate Vision OCR lines/confidence/normalized boxes for every physical page. The reader's PDF logical label remains in that raw observation; the transport printed_label stays null because it was not visually verified as printed ink. Projection keeps separate labelled native/OCR sections and every page partial, including visual-only pages with no recognized text. Unsupported OCR languages, errors and time budget limitations remain explicit. Tiny normalized boundary roundoff has a symmetric 0.000001 tolerance without changing raw values; genuine out-of-range boxes refuse. The `readerEvidence` raw JSON/hash is stored atomically with the packet in the encrypted journal, up to3 MB; maximum individual encrypted record rises from20 to24 MiB while the256 MiB total cap remains. This preserves geometry for future structure support; PDF v1 does not transmit that raw geometry or verify equations/tables/visuals. Unknown native fields, missing pages and text/output overflows refuse, keeping the original.

Real local Mac extraction now covers the synthetic native/scan/visual fixture, two viewer-readable AES fixtures and the owner's retained19-page diagnostic; password-required input refuses. This does not prove Windows support, full mathematical/layout understanding, OS secure-storage behavior or installed/trusted Mac delivery. `build-mac.cjs` accepts an optional fourth absolute native-package folder, validates its manifest/source/binary/architecture, puts the pin inside ASAR and the helper in external Resources/native-pdf, then verifies the helper again after signing. No pin means no new collector. The actual candidate main uses its local recovery controller after file integrity checks, including when website setup fails. Native Save dialogs, Keychain/DPAPI, trusted downloaded installation and real student flows still require installed acceptance.


Recovery accepts only a listed record key/opaque handle/hash, never a destination from the renderer. The main frame must be the exact owning window. Dialog cancellation keeps records; output uses exclusive create, sync and read-back hashing, and never overwrites an existing filename. Unreadable records are counted separately without deleting them. A reveal/Finder failure does not relabel a verified copy as failed. A busy collector/recovery dialog blocks concurrent actions with a visible explanation. Pausing/closing the owned Moodle context aborts its active native file operation, preserving originals and progress and preventing binary fallback.
# Optional retained line positions

The PDF v1 manifest can include `pages[].geometry` only after the server
advertises `line_geometry` with format `neyvu-pdf-lines/1`, `max_lines: 20000`
and `reviewed: false`. Old packets and readers remain valid without it. A new
collector passes that capability to the reader; the default projection does
not add geometry. Never strip geometry from an already retained packet to
make a different server accept it. Pause that exact intent instead. Read-back
of committed sessions remains available when new ingestion is disabled.

Each line binds its exact UTF-8 range and SHA-256 to a same-method block in the
physical page body, before the surrounding `Page N` wrapper. The original
coordinate observations, PDF page size/origin/rotation and provider confidence
are retained. PDFKit coordinates are PDF points from the bottom left; Vision
coordinates are normalized from the bottom left of its page image. They are
different spaces. Rotation, cropping, actual bounding-box accuracy, reading
order and semantic relationships have not been certified by this metadata.

OCR lines preserve their original observed text, including wrong symbols and
high confidence. A native line gets a range only if its text occurs exactly
once in that page's selectable text. Ambiguous or absent matches increment
`native_lines_unmapped`; the full original native observation remains in the
encrypted local journal. No guessed match, symbol correction, matrix-cell or
diagram relationship is synthesized. Every geometry page remains partial,
unreviewed and subject to the existing equation/layout/visual limitations.

The server validates coordinate bounds, methods, page identity, unique IDs,
declared counts, byte ranges, scalar boundaries and exact line hashes. These
are internal consistency checks on a Companion observation, not independent
verification of the source or its author. Whole-manifest 512,000-byte and
20,000-line limits remain enforced; overflow retains the original and fails
without silently dropping positions. Confidence never certifies fidelity.

Future rollout must preserve this optional metadata on inspect and source
read-back, including with ingestion off. Rolling back to a binary that does
not understand the extension after accepting it is unqualified. This change
does not enable the feature, install a Companion or commission storage.
