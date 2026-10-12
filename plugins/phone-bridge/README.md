# phone-bridge plugin

Send documents (photo, signature, marksheet, certificate, PDF) from a phone into a
Camofox browser session and attach them to a form's `<input type="file">`, with no app
install: **scan QR → pair → pick files → send → attach in the browser**.

## How it works

```text
Dashboard (Next.js)                         Camofox server (this plugin)               Phone
───────────────────                         ─────────────────────────────              ─────
"Send files from phone"
  └─ POST /api/phone-bridge/sessions ──►  POST /phone-bridge/sessions
     (server-side proxy adds the            creates pairing bound to userId,
      Camofox key + fixed userId)           returns desktopToken + pairUrl
  QR of pairUrl (drawn locally) ─────────────────────────────────────────────►  scan
                                           GET  /phone-bridge/m  (upload page)  ◄─ opens
                                           POST /phone-bridge/phone/preview     ◄─ shows code
                                           POST /phone-bridge/phone/pair        ◄─ "Pair this phone"
                                             → phoneToken (pairing token consumed)
                                           POST /phone-bridge/phone/files       ◄─ "Send files"
                                             validate size + magic bytes,
                                             store under CAMOFOX_UPLOADS_DIR
  polls GET …/sessions/:id (2 s) ◄────────  status + file list
  "Attach" → GET …/targets ◄──────────────  tabs of this userId + their file inputs
           → POST …/files/:id/attach ────►  core POST /tabs/:tabId/upload
                                             (Playwright setInputFiles on the chosen input)
  user checks the form, submits manually
```

The file reaches the browser through Camofox's existing `POST /tabs/:tabId/upload` route
(called over loopback), so it uses the same tab locks, path checks
(`lib/upload-paths.js`), and upload strategies as every other upload. Files are stored
under `<CAMOFOX_UPLOADS_DIR>/phone-bridge/<sessionId>/files/<fileId>/<name>`, which is
private, never served over HTTP, and inside the only directory the upload route accepts.

## In the form agent (Google Forms file-upload questions)

When `smart-agent.js` reaches a question with an **Add file** button, it:

1. creates a one-file pairing labelled with the question (`maxFiles: 1`, `purpose`);
2. shows the QR code **inside the chat** as that question's bubble (prompt kind `file-upload`);
3. waits for the phone's file (or "skip" typed in chat), then attaches it with
   `pickerIndex`. This clicks that question's "Add file" button, sets the file on the
   picker's input inside its iframe (or uses "Browse" plus the file chooser), clicks
   **Upload** if the picker asks, and waits for the picker to close;
4. marks the question answered in chat (`@@RESOLVED@@` → `prompt-resolved` event),
   closes the pairing, and continues with the next question.

Google Forms file questions require the user to be **signed in to Google** in the
Camofox browser, so the agent's existing "Sign in" pause applies first. The picker flow
was verified against a local mock with the same structure (cross-origin picker iframe,
hidden input, Browse, Upload), not against Google itself, because that needs a signed-in
Google account.

## Credentials

| Credential | Who holds it | Lifetime | Grants |
|---|---|---|---|
| Camofox key (`CAMOFOX_ACCESS_KEY` / `CAMOFOX_API_KEY`) | Dashboard **server** only | permanent | creating pairings (plus the rest of the Camofox API) |
| `desktopToken` | Dashboard browser tab (memory + sessionStorage) | session | status, targets, attach, remove, revoke **for one pairing** |
| `pairingToken` | QR URL **fragment** (`#t=`) | 5 min, single use | preview + confirm pairing |
| `phoneToken` | Phone tab (sessionStorage) | until session ends | upload / status / disconnect **for one pairing**; no browser control |

All tokens are 256-bit random values (`crypto.randomBytes(32)`). The server stores only
SHA-256 hashes and compares them in constant time. Knowing a session ID alone gets
a 404.

## Configuration

Environment variables (read in `lib/config.js`; the same keys also work as
`plugins["phone-bridge"]` settings in `camofox.config.json`):

| Variable | Default | Purpose |
|---|---|---|
| `PHONE_BRIDGE_PUBLIC_URL` | request host | Public base URL the **phone** uses, e.g. `https://como-agents.onrender.com`. Set this in production. |
| `PHONE_BRIDGE_PAIRING_TTL_MS` | `300000` (5 min) | How long a QR code can be used |
| `PHONE_BRIDGE_SESSION_TTL_MS` | `1800000` (30 min) | Session lifetime; files are deleted when it ends |
| `PHONE_BRIDGE_MAX_FILE_BYTES` | `10485760` (10 MB) | Max size per file |
| `PHONE_BRIDGE_MAX_FILES` | `10` | Max files per session |
| `PHONE_BRIDGE_TRUST_PROXY` | off | Use the right-most `X-Forwarded-For` entry for rate limiting (enable behind Render/Fly) |
| `CAMOFOX_UPLOADS_DIR` | `~/.camofox/uploads` | Existing setting; bridge files live in its `phone-bridge/` subdirectory |

Dashboard (`camofox-dashboard`, server-side only, so never `NEXT_PUBLIC_`):

| Variable | Example | Purpose |
|---|---|---|
| `CAMOFOX_INTERNAL_URL` | `https://como-agents.onrender.com` | Where the proxy reaches Camofox |
| `CAMOFOX_ACCESS_KEY` or `CAMOFOX_API_KEY` | `change-me-long-random` | Sent by the proxy as `Authorization: Bearer …` |
| `CAMOFOX_USER_ID` | `default` | Browser session the pairing is bound to (`smart-agent.js` uses `default`) |

## Local testing

```bash
# Camofox (phone must reach this address: use your LAN IP or a tunnel)
CAMOFOX_API_KEY=dev-key PHONE_BRIDGE_PUBLIC_URL=http://192.168.1.20:9377 npm start
# Dashboard
cd camofox-dashboard
CAMOFOX_INTERNAL_URL=http://localhost:9377 CAMOFOX_API_KEY=dev-key npm run dev
```

Phones on the same Wi-Fi can use the LAN URL over plain HTTP for testing. For HTTPS, run
`cloudflared tunnel --url http://localhost:9377` and use its URL as
`PHONE_BRIDGE_PUBLIC_URL`.

Tests: `npx jest plugins/phone-bridge` (22 tests: pairing, expiry, replay, revocation,
upload auth, size/count limits, content sniffing, cross-session isolation, attach
targeting/failure, cleanup after restart, CSP, access-key exemption, rate limiting, and
no tokens in logs) and `npx jest tests/unit/accessKey.test.js` (exemption rules).

## Limitations

- **Standard file inputs only.** Attaching works for `<input type="file">` in the main
  frame, hidden ones included. Custom widgets that only accept drag-and-drop, inputs
  inside cross-origin iframes, and sites that upload via their own JS without an input
  may fail. The bridge then reports the error instead of claiming success.
- **Formats:** PDF, JPEG, PNG, and WebP. HEIC is rejected with a message; iOS normally
  converts it to JPEG when the picker's `accept` lists JPEG.
- **Storage is local to the Camofox container.** On Render the disk is ephemeral, so a
  redeploy loses in-flight sessions and files. That is acceptable for 30-minute
  transfers, and the manifests make sure a *surviving* disk is cleaned up on restart.
  Running more than one Camofox instance would need shared storage and sticky routing.
- **One browser session per dashboard** (`CAMOFOX_USER_ID`), because the dashboard has
  no user login of its own. Anyone who can open the dashboard can create pairings for
  that session.
- The core upload route logs the attached file's path, so document filenames appear in
  server logs.
