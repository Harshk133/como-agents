# Setup: run Form Agent locally

Form Agent is made of three processes and one optional AI backend:

| Part | What it does | Port |
|---|---|---|
| **Camofox server** (`server.js`) | Stealth Firefox (Camoufox) plus the REST API and the phone-bridge plugin | `9377` |
| **Agent backend** (`dashboard-server.js`) | Starts `smart-agent.js` for each run and streams its chat to the dashboard over SSE | `3001` |
| **Dashboard** (`camofox-dashboard/`, Next.js) | Landing page at `/` and the agent chat at `/agent` | `3000` |
| **AI backend** (optional) | Ollama on your PC, or a hosted OpenAI-compatible API key | `11434` |

```text
Browser ──► Dashboard :3000 ──► Agent backend :3001 ──► smart-agent.js ──► Camofox :9377
                 │                                                              ▲
                 └── /api/phone-bridge (adds the API key) ──────────────────────┘
Phone ──(same Wi-Fi, QR code)──► Camofox :9377/phone-bridge/m
```

---

## 1. Prerequisites

- **Node.js 22 or newer** (`node -v`)
- **Docker Desktop** (recommended way to run Camofox, especially on Windows)
- **Git**
- Optional, for AI mode: [Ollama](https://ollama.com) **or** a free API key (see [AI mode](#5-ai-mode-optional))
- Optional, for phone uploads: a phone on the **same Wi-Fi** as your PC

## 2. Install

```bash
git clone https://github.com/Harshk133/como-agents.git
cd como-agents

npm install                      # Camofox server + agent
cd camofox-dashboard && npm install && cd ..
```

---

## 3a. Quick start on Windows (one command)

`scripts/test-phone-bridge.ps1` builds the Docker image, starts Camofox with VNC and the phone bridge enabled, opens the agent backend and the dashboard in their own terminal windows, and shares a freshly generated API key between them.

```powershell
.\scripts\test-phone-bridge.ps1                          # auto-detects your Wi-Fi IP
.\scripts\test-phone-bridge.ps1 -PhoneIp 192.168.0.104   # or set the IP your phone should use
.\scripts\test-phone-bridge.ps1 -Rebuild                 # rebuild the image after code changes
```

When it says **Ready**, open http://localhost:3000 and click **Get started**.

> The first image build takes several minutes. Anything already using ports 3000/3001, and any container publishing 9377, is stopped first.

## 3b. Manual start (any OS, three terminals)

Choose an API key and use the **same value** in all three terminals. The examples below use `dev-key-change-me`.

**Terminal 1: Camofox in Docker**

```bash
docker build --target camofox-browser -t camofox-browser:local .

docker run --rm --name camofox -p 9377:9377 -p 127.0.0.1:6080:6080 \
  -e ENABLE_VNC=1 -e VNC_BIND=0.0.0.0 -e VNC_PASSWORD=change-me \
  -e CAMOFOX_API_KEY=dev-key-change-me \
  -e PHONE_BRIDGE_PUBLIC_URL=http://<YOUR_PC_WIFI_IP>:9377 \
  camofox-browser:local sh -c 'node --max-old-space-size=256 server.js'
```

Check it with http://localhost:9377/health, which should return JSON.

> The command passes its own `sh -c 'node … server.js'` on purpose: the image's default `CMD` is for the hosted gateway setup, not for running locally.
>
> Without Docker you can run `npm start` in the repo root. Camoufox is downloaded on `npm install`, but live view (VNC) only works in Docker/Linux.

**Terminal 2: agent backend** (from the repo root)

```bash
# bash
CAMOFOX_API_PORT=9377 CAMOFOX_API_KEY=dev-key-change-me DASHBOARD_PORT=3001 node dashboard-server.js
```
```powershell
# PowerShell
$env:CAMOFOX_API_PORT='9377'; $env:CAMOFOX_API_KEY='dev-key-change-me'; $env:DASHBOARD_PORT='3001'; node dashboard-server.js
```

**Terminal 3: dashboard**

Create `camofox-dashboard/.env.local`:

```ini
CAMOFOX_INTERNAL_URL=http://localhost:9377
CAMOFOX_API_KEY=dev-key-change-me
NEXT_PUBLIC_CAMOFOX_URL=http://localhost:9377
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
NEXT_PUBLIC_VNC_URL=http://localhost:6080/vnc.html
NEXT_PUBLIC_VNC_PASSWORD=change-me
```

Then start it:

```bash
cd camofox-dashboard
npm run dev
```

Open http://localhost:3000 for the landing page, or go straight to http://localhost:3000/agent.

---

## 4. Use it

1. On `/agent`, paste a **Google Forms** link (only `docs.google.com/forms/...` links are accepted).
2. Choose **Guided** (the agent asks you every question in chat) or **AI** (the AI answers by itself).
3. Watch the browser in the live view, and answer in chat when the robot is *listening*.
4. If the form needs you to **sign in to Google** (all file-upload forms do), sign in through the live view. The agent waits until you have.
5. When the agent reaches a **file-upload question**, a QR code appears in the chat. Scan it with your phone, pick the file, and press **Send**. The agent attaches it to the form and continues. Type `skip` to leave the question empty.

## 5. AI mode (optional)

Set these in **terminal 2** (the agent backend). It passes them on to `smart-agent.js`.

**Option A: Ollama (local, free)**

```bash
ollama pull qwen2.5:3b          # default model
# optional overrides:
OLLAMA_MODEL=qwen2.5:3b
OLLAMA_URL=http://localhost:11434/api/generate
```

**Option B: a hosted OpenAI-compatible API (no GPU needed)**

If `LLM_API_KEY` is set, it is used instead of Ollama.

| Provider | `LLM_BASE_URL` | Example `LLM_MODEL` |
|---|---|---|
| DeepSeek (default) | `https://api.deepseek.com/v1` | `deepseek-chat` |
| Groq (free tier) | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| Google Gemini (free tier) | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.0-flash` |
| OpenRouter (free models) | `https://openrouter.ai/api/v1` | any model ending in `:free` |

```bash
LLM_API_KEY=your-key LLM_BASE_URL=https://api.groq.com/openai/v1 LLM_MODEL=llama-3.3-70b-versatile \
CAMOFOX_API_PORT=9377 CAMOFOX_API_KEY=dev-key-change-me node dashboard-server.js
```

Never commit API keys. `.env` and `.env.local` are already in `.gitignore`.

## 6. Phone uploads: checklist

Your phone connects **directly to Camofox on port 9377**, so:

1. **Find your PC's Wi-Fi IP.** On Windows run `ipconfig` and use the IPv4 address under **"Wireless LAN adapter Wi-Fi"**. Ignore entries for Mobile Hotspot, vEthernet, WSL and VirtualBox.
2. Set `PHONE_BRIDGE_PUBLIC_URL=http://<that IP>:9377` on the Camofox container (the quick-start script does this for you).
3. **Allow port 9377 through Windows Firewall** (run once, in an *Administrator* PowerShell):
   ```powershell
   New-NetFirewallRule -DisplayName "Camofox phone bridge 9377" -Direction Inbound -Protocol TCP -LocalPort 9377 -Action Allow -Profile Private
   ```
4. Make sure your Wi-Fi network profile is **Private**, not Public (Settings → Network & internet → Wi-Fi → your network).
5. Test it: open `http://<that IP>:9377/health` on your phone. If you see JSON, phone uploads will work.

QR codes can be used only once and expire after 5 minutes. Files are limited to 10 MB and must be PDF, JPEG, PNG or WebP, and they are deleted when the session ends. See [`plugins/phone-bridge/README.md`](plugins/phone-bridge/README.md) for the security model and every setting.

## 7. Tests

```bash
npm run test:unit                 # unit tests
npm run test:plugins              # plugin tests, including phone-bridge
npm test                          # unit + e2e + plugins
cd camofox-dashboard && npm run lint
```

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| Phone shows "This site can't be reached" | Firewall rule missing, Wi-Fi set to Public, wrong IP, or the phone is on a different network (mobile data, guest Wi-Fi). Go through [section 6](#6-phone-uploads-checklist) again. |
| Your IP changed after a reboot | Run `ipconfig` again and restart Camofox with the new `PHONE_BRIDGE_PUBLIC_URL` (or rerun the script). |
| Dashboard status shows **Offline** | Terminal 2 isn't running, or `NEXT_PUBLIC_BACKEND_URL` doesn't point to port 3001. |
| `401` / unauthorized errors | `CAMOFOX_API_KEY` is not exactly the same in Camofox, the agent backend and `.env.local`. |
| AI mode: "AI mode requires Ollama running…" or "could not reach…" | Start Ollama (`ollama serve`) and pull the model, or check `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL`. |
| The agent skips a file question | You're not signed in to Google in the live view. File questions only appear for signed-in users. |
| Port already in use | Stop whatever is using 9377/3000/3001 (`docker ps`, `Get-NetTCPConnection -LocalPort 3000`). |
| `powershell` not recognized when running the script | Run it from Windows PowerShell, or add `C:\Windows\System32\WindowsPowerShell\v1.0` to `PATH`. |
