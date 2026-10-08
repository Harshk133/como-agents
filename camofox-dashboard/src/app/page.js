'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { BorderBeam } from 'border-beam';

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

const CAMOFOX_URL =
  process.env.NEXT_PUBLIC_CAMOFOX_URL || 'http://localhost:9377';
const VNC_BASE = process.env.NEXT_PUBLIC_VNC_URL || 'http://localhost:6080/vnc.html';
const VNC_PASSWORD = process.env.NEXT_PUBLIC_VNC_PASSWORD || 'your-secret-password';

const NAVBAR_H = 'h-14';

function buildVncSrc() {
  const params = new URLSearchParams({
    autoconnect: 'true',
    resize: 'scale',
  });
  if (VNC_PASSWORD) params.set('password', VNC_PASSWORD);
  return `${VNC_BASE}?${params.toString()}`;
}

function formatLogTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function logEntry(role, text, extra = {}) {
  return { role, text, ts: Date.now(), ...extra };
}

function isGoogleFormUrl(raw) {
  try {
    const u = new URL(String(raw).trim());
    if (!u.hostname.endsWith('google.com')) return false;
    return u.pathname.includes('/forms/');
  } catch {
    return false;
  }
}

function inferToolFromLog(text) {
  const raw = text || '';
  const t = raw.replace(/^[^\s]+\s*/, '').trim();
  const lower = raw.toLowerCase();

  if (lower.includes('navigat') || lower.includes('opening browser')) {
    return { name: 'browser.navigate', label: 'Navigate', detail: t || raw };
  }
  if (lower.includes('scanning form page')) {
    return { name: 'form.scan', label: 'Scan form', detail: t || raw };
  }
  if (lower.includes('click')) {
    return { name: 'browser.click', label: 'Click', detail: t || raw };
  }
  if (lower.includes('type') || lower.includes('fill') || lower.includes('enter')) {
    return { name: 'browser.type', label: 'Type', detail: t || raw };
  }
  if (lower.includes('scroll')) {
    return { name: 'browser.scroll', label: 'Scroll', detail: t || raw };
  }
  if (lower.includes('snapshot') || lower.includes('form:')) {
    return { name: 'browser.snapshot', label: 'Snapshot', detail: t || raw };
  }
  return null;
}

function StatusDot({ ok, label, muted }) {
  const color =
    ok === true
      ? 'bg-emerald-500/90'
      : ok === false
        ? 'bg-red-500/90'
        : 'bg-[#666666]';
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] ${muted ? 'text-[#666666]' : 'text-[#A1A1A1]'}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function ToolCallCard({ tool, ts }) {
  return (
    <div className="my-2 overflow-hidden rounded-xl border border-[#292929] bg-[#0B0B0B]/90">
      <div className="flex items-center justify-between gap-2 border-b border-[#292929] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[#7C3AED]/20 text-[10px] text-[#8B5CF6]">
            ⚡
          </span>
          <span className="truncate font-mono text-[11px] text-[#F5F5F5]">{tool.name}</span>
        </div>
        <span className="shrink-0 rounded-full border border-emerald-900/50 bg-emerald-950/40 px-2 py-0.5 text-[9px] uppercase tracking-wide text-emerald-400/90">
          done
        </span>
      </div>
      <div className="px-3 py-2">
        <p className="text-[11px] font-medium text-[#A1A1A1]">{tool.label}</p>
        <p className="mt-1 line-clamp-3 font-mono text-[11px] leading-relaxed text-[#666666]">
          {tool.detail}
        </p>
        {ts ? (
          <p className="mt-1.5 font-mono text-[10px] text-[#444444]">{formatLogTime(ts)}</p>
        ) : null}
      </div>
    </div>
  );
}

function ChatBubble({ entry }) {
  const isUser = entry.role === 'user';
  const isError = entry.role === 'error';

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[92%] rounded-2xl rounded-br-md bg-[#7C3AED] px-3.5 py-2.5 text-sm leading-relaxed text-white">
          <p className="whitespace-pre-wrap break-words">{entry.text}</p>
          {entry.ts ? (
            <p className="mt-1 text-[10px] text-white/50">{formatLogTime(entry.ts)}</p>
          ) : null}
        </div>
      </div>
    );
  }

  const bubbleClass = isError
    ? 'border-red-900/40 bg-red-950/25 text-red-200/90'
    : entry.role === 'system'
      ? 'border-[#292929] bg-[#151515]/80 text-[#A1A1A1]'
      : 'border-[#292929] bg-[#151515]/90 text-[#F5F5F5]';

  return (
    <div className="flex justify-start">
      <div
        className={`max-w-[92%] rounded-2xl rounded-bl-md border px-3.5 py-2.5 text-sm leading-relaxed ${bubbleClass}`}
      >
        <p className="whitespace-pre-wrap break-words">{entry.text}</p>
        {entry.ts ? (
          <p className="mt-1 font-mono text-[10px] text-[#666666]">{formatLogTime(entry.ts)}</p>
        ) : null}
      </div>
    </div>
  );
}

function ChatComposer({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder,
  mode,
  onModeChange,
  modeLocked,
  showStop,
  onStop,
}) {
  const canSend = !disabled && value.trim().length > 0;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-[#292929] bg-[#111111]/95 shadow-[0_0_40px_-12px_rgba(124,58,237,0.35)]">
      <BorderBeam>
        <div className="relative p-3">
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (canSend) onSubmit();
              }
            }}
            disabled={disabled}
            rows={composerRows(value, placeholder)}
            placeholder={placeholder}
            className="max-h-32 min-h-[44px] w-full resize-none bg-transparent text-sm leading-relaxed text-[#F5F5F5] placeholder:text-[#666666] focus:outline-none disabled:opacity-50"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="inline-flex rounded-full border border-[#292929] bg-[#0B0B0B] p-0.5 text-[11px]">
                <button
                  type="button"
                  disabled={modeLocked}
                  onClick={() => onModeChange('manual')}
                  className={`rounded-full px-2.5 py-1 transition-colors disabled:opacity-40 ${mode === 'manual'
                      ? 'bg-[#7C3AED] text-white'
                      : 'text-[#666666] hover:text-[#A1A1A1]'
                    }`}
                >
                  Guided
                </button>
                <button
                  type="button"
                  disabled={modeLocked}
                  onClick={() => onModeChange('ai')}
                  className={`rounded-full px-2.5 py-1 transition-colors disabled:opacity-40 ${mode === 'ai'
                      ? 'bg-[#7C3AED] text-white'
                      : 'text-[#666666] hover:text-[#A1A1A1]'
                    }`}
                >
                  AI
                </button>
              </div>
              <span className="hidden text-[10px] text-[#444444] sm:inline">Enter to send</span>
            </div>
            <div className="flex items-center gap-1.5">
              {showStop ? (
                <button
                  type="button"
                  onClick={onStop}
                  className="rounded-full border border-[#292929] px-3 py-1.5 text-[11px] text-[#A1A1A1] transition-colors hover:border-red-900/50 hover:text-red-300/90"
                >
                  Stop
                </button>
              ) : null}
              <button
                type="button"
                disabled={!canSend}
                onClick={onSubmit}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[#7C3AED] text-white transition-all hover:bg-[#8B5CF6] disabled:bg-[#292929] disabled:text-[#666666]"
                aria-label="Send"
              >
                ↑
              </button>
            </div>
          </div>
        </div>
      </BorderBeam>
    </div>
  );
}

function composerRows(value, placeholder) {
  if (value.includes('\n')) return Math.min(4, value.split('\n').length);
  if (placeholder?.includes('Form link')) return 2;
  return 1;
}

export default function Dashboard() {
  const [logs, setLogs] = useState([]);
  const [currentPrompt, setCurrentPrompt] = useState(null);
  const [composerText, setComposerText] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [mode, setMode] = useState('manual');
  const [backendOk, setBackendOk] = useState(null);
  const [vncReady, setVncReady] = useState(null);
  const [agentPanelOpen, setAgentPanelOpen] = useState(false);
  const [chatStarted, setChatStarted] = useState(false);
  const [activeFormUrl, setActiveFormUrl] = useState(null);
  const logsEndRef = useRef(null);
  const vncContainerRef = useRef(null);
  const vncSrc = useMemo(() => buildVncSrc(), []);

  const agentConnected = backendOk === true;

  const threadItems = useMemo(() => {
    const items = [];
    for (const entry of logs) {
      if (entry.role === 'log') {
        const tool = inferToolFromLog(entry.text);
        if (tool) {
          items.push({ kind: 'tool', id: `tool-${entry.ts}-${tool.name}`, tool, ts: entry.ts });
          continue;
        }
      }
      items.push({ kind: 'chat', id: `chat-${entry.ts}-${entry.role}`, entry });
    }
    return items;
  }, [logs]);

  useEffect(() => {
    let cancelled = false;
    async function pollVnc() {
      try {
        const res = await fetch(`${CAMOFOX_URL}/vnc/status`);
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (!cancelled) setVncReady(Boolean(data.running));
      } catch {
        if (!cancelled) setVncReady(false);
      }
    }
    pollVnc();
    const id = setInterval(pollVnc, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const eventSource = new EventSource(`${BACKEND_URL}/api/logs`);
    eventSource.onopen = () => setBackendOk(true);
    eventSource.onerror = () => setBackendOk(false);
    eventSource.onmessage = (event) => {
      setBackendOk(true);
      const data = JSON.parse(event.data);
      if (data.type === 'prompt') {
        setCurrentPrompt(data);
        const label = data.question || data.kind || 'Input needed';
        setLogs((prev) => [...prev, logEntry('agent', label)]);
      } else if (data.type === 'done') {
        setIsRunning(false);
        setCurrentPrompt(null);
        setLogs((prev) => [...prev, logEntry('system', data.message)]);
      } else if (data.type === 'error') {
        setIsRunning(false);
        setLogs((prev) => [...prev, logEntry('error', data.message)]);
      } else {
        setLogs((prev) => [...prev, logEntry('log', data.message)]);
      }
    };
    return () => eventSource.close();
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs, currentPrompt]);

  const runAgent = async (formUrl) => {
    setIsRunning(true);
    setCurrentPrompt(null);
    setLogs((prev) => [
      ...prev,
      logEntry(
        'system',
        mode === 'ai'
          ? 'Starting AI mode — Ollama answers each field autonomously.'
          : 'Starting guided mode — reply in chat when asked.',
      ),
    ]);
    try {
      const res = await fetch(`${BACKEND_URL}/api/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, formUrl }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
    } catch (err) {
      setLogs((prev) => [
        ...prev,
        logEntry('error', `Failed to start agent: ${err.message}`),
      ]);
      setIsRunning(false);
    }
  };

  const stopAgent = async () => {
    try {
      await fetch(`${BACKEND_URL}/api/stop`, { method: 'POST' });
    } catch {
      /* ignore */
    }
    setIsRunning(false);
    setCurrentPrompt(null);
  };

  const submitAnswer = async (answerRaw) => {
    const value =
      currentPrompt?.kind === 'login' ? 'continue' : answerRaw.trim();
    if (!value && currentPrompt?.kind !== 'login') return;

    setLogs((prev) => [
      ...prev,
      logEntry(
        'user',
        currentPrompt?.kind === 'login' ? 'Continue after login' : value,
      ),
    ]);
    try {
      await fetch(`${BACKEND_URL}/api/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: value }),
      });
      setComposerText('');
      setCurrentPrompt(null);
    } catch (err) {
      setLogs((prev) => [
        ...prev,
        logEntry('error', `Failed to send answer: ${err.message}`),
      ]);
    }
  };

  const handleComposerSubmit = async () => {
    const text = composerText.trim();
    if (!text && currentPrompt?.kind !== 'login') return;

    if (currentPrompt) {
      await submitAnswer(text);
      return;
    }

    const startingNewRun = !isRunning && isGoogleFormUrl(text);
    if (!chatStarted || startingNewRun) {
      if (!isGoogleFormUrl(text)) {
        setLogs((prev) => [
          ...prev,
          logEntry('error', 'Paste a valid Google Forms link (docs.google.com/forms/…).'),
        ]);
        return;
      }
      setChatStarted(true);
      setActiveFormUrl(text);
      setLogs((prev) => [...prev, logEntry('user', text)]);
      setComposerText('');
      await runAgent(text);
    }
  };

  const toggleFullscreen = useCallback(() => {
    const el = vncContainerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      el.requestFullscreen?.();
    }
  }, []);

  const composerPlaceholder = !chatStarted
    ? 'Paste Google Form link…'
    : currentPrompt?.kind === 'login'
      ? 'Sign in on the right, then send or click Continue…'
      : currentPrompt
        ? 'Your answer for this field…'
        : isRunning
          ? 'Agent is working…'
          : 'Paste another form link to run again…';

  const composerDisabled = isRunning && !currentPrompt;

  const modeLocked = isRunning;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#0B0B0B] text-[#F5F5F5]">
      <header
        className={`${NAVBAR_H} flex shrink-0 items-center justify-between border-b border-[#292929] bg-[#0B0B0B] px-3 sm:px-4`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex items-center gap-2 border-r border-[#292929] pr-3">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#292929] bg-[#151515] text-sm text-[#8B5CF6]"
              aria-hidden
            >
              ◈
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium leading-tight">Form Agent</p>
              <p className="hidden truncate text-[11px] text-[#666666] sm:block">
                {activeFormUrl ? 'Session active' : 'Chat to fill forms'}
              </p>
            </div>
          </div>
          <StatusDot
            ok={isRunning ? true : agentConnected}
            label={isRunning ? 'Running' : agentConnected ? 'Ready' : 'Offline'}
            muted={!agentConnected && !isRunning}
          />
        </div>
        <button
          type="button"
          onClick={() => setAgentPanelOpen(true)}
          className="rounded-lg border border-[#292929] px-2.5 py-1 text-xs text-[#A1A1A1] lg:hidden"
        >
          Chat
        </button>
      </header>

      {backendOk === false && (
        <p className="shrink-0 border-b border-red-900/30 bg-red-950/20 px-4 py-2 text-center text-[11px] text-red-300/90">
          Backend unreachable at {BACKEND_URL} — run{' '}
          <code className="font-mono">node dashboard-server.js</code>
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        <aside
          className={`flex w-full flex-col bg-[#0B0B0B] lg:w-[32%] lg:min-w-[340px] lg:max-w-[440px] lg:border-r lg:border-[#292929] ${agentPanelOpen
              ? 'fixed inset-0 top-14 z-20 flex lg:static lg:z-auto'
              : 'hidden lg:flex'
            }`}
        >
          <div className="flex min-h-0 flex-1 flex-col px-3 py-3 sm:px-4">
            <div className="min-h-0 flex-1 overflow-y-auto">
              {!chatStarted && logs.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center px-2 text-center">
                  <p className="text-sm font-medium text-[#F5F5F5]">Fill Google Forms with Camofox</p>
                  <p className="mt-2 max-w-[260px] text-xs leading-relaxed text-[#666666]">
                    Paste a form link below. The agent scans fields in the live browser on the right.
                  </p>
                </div>
              ) : (
                <div className="space-y-3 pb-2">
                  {currentPrompt ? (
                    <div className="rounded-xl border border-[#7C3AED]/30 bg-[#7C3AED]/10 px-3 py-2.5">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-[#8B5CF6]">
                        {currentPrompt.kind === 'login' ? 'Sign in' : 'Question'}
                      </p>
                      <p className="mt-1 text-sm text-[#F5F5F5]">{currentPrompt.question}</p>
                      {currentPrompt.fieldType ? (
                        <p className="mt-1 text-[10px] text-[#666666]">
                          {currentPrompt.fieldType}
                        </p>
                      ) : null}
                      {currentPrompt.options?.length ? (
                        <ul className="mt-2 space-y-0.5 text-[11px] text-[#A1A1A1]">
                          {currentPrompt.options.map((opt) => (
                            <li key={opt.ref || opt.index}>
                              <span className="font-mono text-[#8B5CF6]">{opt.index}.</span>{' '}
                              {opt.label}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {currentPrompt.kind === 'login' ? (
                        <button
                          type="button"
                          onClick={() => submitAnswer('continue')}
                          className="mt-3 w-full rounded-lg bg-[#7C3AED] py-2 text-xs font-medium text-white hover:bg-[#8B5CF6]"
                        >
                          Continue after login
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  {threadItems.map((item) =>
                    item.kind === 'tool' ? (
                      <ToolCallCard key={item.id} tool={item.tool} ts={item.ts} />
                    ) : (
                      <ChatBubble key={item.id} entry={item.entry} />
                    ),
                  )}
                  <div ref={logsEndRef} />
                </div>
              )}
            </div>

            <div className="shrink-0 pt-2">
              <ChatComposer
                value={composerText}
                onChange={setComposerText}
                onSubmit={handleComposerSubmit}
                disabled={composerDisabled}
                placeholder={composerPlaceholder}
                mode={mode}
                onModeChange={setMode}
                modeLocked={modeLocked}
                showStop={isRunning}
                onStop={stopAgent}
              />
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-between border-t border-[#292929] px-4 py-2 lg:hidden">
            <StatusDot ok={vncReady} label="Live browser" muted />
            <button
              type="button"
              onClick={() => setAgentPanelOpen(false)}
              className="text-[11px] text-[#666666]"
            >
              Close
            </button>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col bg-[#0B0B0B]">
          <div className="flex shrink-0 items-center justify-between border-b border-[#292929] px-4 py-2">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-[#666666]">
                Browser
              </p>
              <StatusDot ok={vncReady} label={vncReady ? 'Live' : 'Standby'} />
            </div>
            <button
              type="button"
              onClick={toggleFullscreen}
              className="rounded border border-[#292929] px-2 py-1 text-xs text-[#A1A1A1] transition-colors hover:bg-[#151515] hover:text-[#F5F5F5]"
            >
              ⛶ Fullscreen
            </button>
          </div>

          <div ref={vncContainerRef} className="relative min-w-0 flex-1 bg-black">
            <iframe
              src={vncSrc}
              title="Camofox live browser"
              className="absolute inset-0 h-full w-full border-0"
              allow="clipboard-read; clipboard-write"
            />
            <div className="pointer-events-none absolute left-3 right-3 top-3 z-10 space-y-2">
              {!VNC_PASSWORD && (
                <p className="w-fit max-w-xl border border-amber-900/50 bg-[#151515]/95 px-3 py-2 text-[11px] text-amber-200/90">
                  Set <code className="font-mono text-amber-100/90">NEXT_PUBLIC_VNC_PASSWORD</code>{' '}
                  in <code className="font-mono text-amber-100/90">.env.local</code> to match Docker{' '}
                  <code className="font-mono text-amber-100/90">VNC_PASSWORD</code>.
                </p>
              )}
              {vncReady === false && chatStarted && (
                <p className="w-fit max-w-xl border border-[#292929] bg-[#151515]/95 px-3 py-2 text-[11px] text-[#A1A1A1]">
                  Launching browser — the form appears here once Camofox connects.
                </p>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
