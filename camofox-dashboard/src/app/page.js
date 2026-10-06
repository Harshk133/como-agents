'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

const CAMOFOX_URL =
  process.env.NEXT_PUBLIC_CAMOFOX_URL || 'http://localhost:9377';
const VNC_BASE = process.env.NEXT_PUBLIC_VNC_URL || 'http://localhost:6080/vnc.html';
const VNC_PASSWORD = process.env.NEXT_PUBLIC_VNC_PASSWORD || '';

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

function logEntry(role, text) {
  return { role, text, ts: Date.now() };
}

function inferAction(entry) {
  const t = (entry.text || '').replace(/^[^\s]+\s*/, '').trim();
  const raw = entry.text || '';

  if (entry.role === 'user') {
    return { icon: '⌨', label: 'Input', detail: t || raw };
  }

  const lower = raw.toLowerCase();
  if (lower.includes('navigat') || lower.includes('opening browser')) {
    return { icon: '↗', label: 'Navigate', detail: t || raw };
  }
  if (lower.includes('search')) {
    return { icon: '⌕', label: 'Search', detail: t || raw };
  }
  if (lower.includes('click')) {
    return { icon: '▣', label: 'Click', detail: t || raw };
  }
  if (lower.includes('type') || lower.includes('fill') || lower.includes('enter')) {
    return { icon: '⌨', label: 'Type', detail: t || raw };
  }
  if (entry.role === 'agent') {
    return { icon: '◆', label: 'Prompt', detail: t || raw };
  }

  return null;
}

function SectionLabel({ children }) {
  return (
    <div className="mb-3">
      <p className="border border-red-500 text-[11px] font-medium uppercase tracking-wider text-[#666666]">
        {children}
      </p>
      <div className="mt-2 border-b border-[#292929]" />
    </div>
  );
}

function StatusDot({ ok, label, muted }) {
  const color =
    ok === true
      ? 'bg-emerald-500/90'
      : ok === false
        ? 'bg-red-500/90'
        : 'bg-[#666666]';
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${muted ? 'text-[#666666]' : 'text-[#A1A1A1]'}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${color}`} />
      {label}
    </span>
  );
}

export default function Dashboard() {
  const [logs, setLogs] = useState([]);
  const [currentPrompt, setCurrentPrompt] = useState(null);
  const [answerInput, setAnswerInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [mode, setMode] = useState('manual');
  const [backendOk, setBackendOk] = useState(null);
  const [vncReady, setVncReady] = useState(null);
  const [agentPanelOpen, setAgentPanelOpen] = useState(false);
  const logsEndRef = useRef(null);
  const vncContainerRef = useRef(null);
  const vncSrc = useMemo(() => buildVncSrc(), []);

  const agentConnected = backendOk === true;
  const sessionLabel = mode === 'ai' ? 'AI (Ollama)' : 'Guided form fill';

  const actions = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const entry of logs) {
      const action = inferAction(entry);
      if (!action) continue;
      const key = `${action.label}:${action.detail}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...action, ts: entry.ts });
    }
    return out.slice(-12);
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
        setLogs((prev) => [...prev, logEntry('agent', `🤖 ${label}`)]);
      } else if (data.type === 'done') {
        setIsRunning(false);
        setCurrentPrompt(null);
        setLogs((prev) => [...prev, logEntry('system', data.message)]);
      } else if (data.type === 'error') {
        setIsRunning(false);
        setLogs((prev) => [...prev, logEntry('error', `❌ ${data.message}`)]);
      } else {
        setLogs((prev) => [...prev, logEntry('log', data.message)]);
      }
    };
    return () => eventSource.close();
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const runAgent = async () => {
    setIsRunning(true);
    setLogs([
      logEntry(
        'system',
        mode === 'ai'
          ? '🚀 Starting AI mode — Ollama will answer each field autonomously.'
          : '🚀 Starting guided mode — answer each prompt below; values go into the live browser.',
      ),
    ]);
    setCurrentPrompt(null);
    setAnswerInput('');
    try {
      await fetch(`${BACKEND_URL}/api/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
    } catch (err) {
      setLogs((prev) => [
        ...prev,
        logEntry('error', `❌ Failed to connect to dashboard backend: ${err.message}`),
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

  const submitAnswer = async () => {
    const value =
      currentPrompt?.kind === 'login' ? 'continue' : answerInput.trim();
    if (!value && currentPrompt?.kind !== 'login') return;

    setLogs((prev) => [
      ...prev,
      logEntry(
        'user',
        currentPrompt?.kind === 'login' ? '✓ Continue' : value,
      ),
    ]);
    try {
      await fetch(`${BACKEND_URL}/api/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: value }),
      });
      setAnswerInput('');
      setCurrentPrompt(null);
    } catch (err) {
      setLogs((prev) => [
        ...prev,
        logEntry('error', `❌ Failed to send answer: ${err.message}`),
      ]);
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

  const promptOptions = currentPrompt?.options;

  const activityDotClass = (role) => {
    if (role === 'error') return 'text-red-400/80';
    if (role === 'user') return 'text-[#8B5CF6]';
    if (role === 'agent') return 'text-[#8B5CF6]';
    if (role === 'system') return 'text-emerald-400/80';
    return 'text-[#666666]';
  };

  const activityTextClass = (role) => {
    if (role === 'error') return 'text-red-300/90';
    if (role === 'user') return 'text-[#F5F5F5]';
    if (role === 'agent') return 'text-[#F5F5F5]';
    if (role === 'system') return 'text-[#A1A1A1]';
    return 'text-emerald-400/85 font-mono text-[12px]';
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#0B0B0B] text-[#F5F5F5]">
      {/* Top navigation */}
      <header
        className={`${NAVBAR_H} flex shrink-0 items-center justify-between border-b border-[#292929] bg-[#0B0B0B] px-3 sm:px-4`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex items-center gap-2 border-r border-[#292929] pr-3">
            <span
              className="flex h-7 w-7 items-center justify-center rounded border border-[#292929] bg-[#151515] text-sm text-[#8B5CF6]"
              aria-hidden
            >
              ◈
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium leading-tight">Form Agent</p>
              <p className="hidden truncate text-[11px] text-[#666666] sm:block">
                Browser automation
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Left: agent panel — 30% */}
        <aside
          className={`flex w-full flex-col border-[#292929] bg-[#111111] lg:w-[30%] lg:min-w-[320px] lg:max-w-[480px] lg:border-r ${
            agentPanelOpen
              ? 'fixed inset-0 top-14 z-20 flex lg:static lg:z-auto'
              : 'hidden lg:flex'
          }`}
        >
          <div className="shrink-0 border-b border-[#292929] px-4 py-3">
            <SectionLabel>Agent</SectionLabel>
            <p className="text-sm font-medium">Form filling agent</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <StatusDot
                ok={isRunning ? true : backendOk}
                label={isRunning ? 'Running' : agentConnected ? 'Ready' : 'Disconnected'}
              />
              {backendOk === false && (
                <p className="text-[11px] text-red-400/90">
                  API unreachable at {BACKEND_URL} — run{' '}
                  <code className="font-mono text-red-300/90">node dashboard-server.js</code>
                </p>
              )}
            </div>
          </div>

          <div className="shrink-0 border-b border-[#292929] px-4 py-3">
            <SectionLabel>Mode</SectionLabel>
            <div className="inline-flex rounded border border-[#292929] p-0.5 text-xs">
              <button
                type="button"
                disabled={isRunning}
                onClick={() => setMode('manual')}
                className={`rounded px-3 py-1.5 transition-colors disabled:opacity-50 ${
                  mode === 'manual'
                    ? 'bg-[#7C3AED] text-white'
                    : 'text-[#A1A1A1] hover:text-[#F5F5F5]'
                }`}
              >
                Guided
              </button>
              <button
                type="button"
                disabled={isRunning}
                onClick={() => setMode('ai')}
                className={`rounded px-3 py-1.5 transition-colors disabled:opacity-50 ${
                  mode === 'ai'
                    ? 'bg-[#7C3AED] text-white'
                    : 'text-[#A1A1A1] hover:text-[#F5F5F5]'
                }`}
              >
                AI (Ollama)
              </button>
            </div>
          </div>

          <div className="shrink-0 border-b border-[#292929] px-4 py-3">
            <SectionLabel>Task</SectionLabel>

            {currentPrompt ? (
              <div className="space-y-3">
                <div className="border border-[#292929] bg-[#0B0B0B] p-3">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-[#8B5CF6]">
                    {currentPrompt.kind === 'login'
                      ? 'Sign in required'
                      : 'Answer for the form'}
                  </p>
                  <p className="mt-1 text-sm text-[#F5F5F5]">{currentPrompt.question}</p>
                  {currentPrompt.fieldType && (
                    <p className="mt-2 text-[10px] uppercase tracking-wide text-[#666666]">
                      Field: {currentPrompt.fieldType}
                    </p>
                  )}
                  {promptOptions?.length ? (
                    <ul className="mt-2 space-y-1 border-t border-[#292929] pt-2 text-xs text-[#A1A1A1]">
                      {promptOptions.map((opt) => (
                        <li key={opt.ref || opt.index}>
                          <span className="font-mono text-[#8B5CF6]">{opt.index}.</span>{' '}
                          {opt.label}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {currentPrompt.hint && (
                    <p className="mt-2 text-[11px] text-[#666666]">{currentPrompt.hint}</p>
                  )}
                </div>

                {currentPrompt.kind === 'login' ? (
                  <button
                    type="button"
                    onClick={submitAnswer}
                    className="w-full border border-[#7C3AED] bg-[#7C3AED] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#8B5CF6]"
                  >
                    Continue after login
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={answerInput}
                      onChange={(e) => setAnswerInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && submitAnswer()}
                      placeholder="Type your answer (or skip)…"
                      className="min-w-0 flex-1 border border-[#292929] bg-[#0B0B0B] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#666666] focus:border-[#7C3AED] focus:outline-none"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={submitAnswer}
                      className="shrink-0 border border-[#7C3AED] bg-[#7C3AED] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#8B5CF6]"
                    >
                      Submit
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs leading-relaxed text-[#A1A1A1]">
                  {isRunning
                    ? mode === 'ai'
                      ? 'AI is filling the form — follow progress in Activity below.'
                      : 'Waiting for the next question…'
                    : 'Start the agent to fill the Google Form in Camofox. Watch the live browser on the right.'}
                </p>
                <p className="text-[11px] text-[#666666]">
                  Requires Camofox API (9377) and noVNC (6080).
                </p>
                <button
                  type="button"
                  onClick={runAgent}
                  disabled={isRunning}
                  className="w-full border border-[#7C3AED] bg-[#7C3AED] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#8B5CF6] disabled:border-[#292929] disabled:bg-[#151515] disabled:text-[#666666]"
                >
                  {isRunning ? 'Running…' : 'Run agent'}
                </button>
              </div>
            )}
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              <SectionLabel>Activity</SectionLabel>
              {logs.length === 0 ? (
                <p className="text-xs text-[#666666]">No activity yet.</p>
              ) : (
                <ul className="space-y-3">
                  {logs.map((entry, i) => (
                    <li key={i} className="flex gap-2 text-xs leading-snug">
                      <span className={`mt-0.5 shrink-0 ${activityDotClass(entry.role)}`}>
                        ●
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className={`whitespace-pre-wrap break-words ${activityTextClass(entry.role)}`}>
                          {entry.text}
                        </p>
                        {entry.ts && (
                          <p className="mt-0.5 font-mono text-[10px] text-[#666666]">
                            {formatLogTime(entry.ts)}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                  <li ref={logsEndRef} />
                </ul>
              )}

              {actions.length > 0 && (
                <div className="mt-6">
                  <SectionLabel>Actions</SectionLabel>
                  <ul className="divide-y divide-[#292929] border border-[#292929]">
                    {actions.map((action, i) => (
                      <li key={i} className="px-3 py-2.5">
                        <p className="text-xs text-[#F5F5F5]">
                          <span className="mr-2 text-[#A1A1A1]">{action.icon}</span>
                          {action.label}
                        </p>
                        <p className="mt-0.5 truncate pl-5 font-mono text-[11px] text-[#666666]">
                          {action.detail}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          <div className="shrink-0 border-t border-[#292929] bg-[#111111] px-4 py-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <StatusDot
                ok={agentConnected}
                label={agentConnected ? 'Agent connected' : 'Agent offline'}
                muted={!agentConnected}
              />
              <button
                type="button"
                onClick={() => setAgentPanelOpen(false)}
                className="text-[11px] text-[#666666] hover:text-[#A1A1A1] lg:hidden"
              >
                Close panel
              </button>
            </div>
            {isRunning && (
              <button
                type="button"
                onClick={stopAgent}
                className="w-full border border-[#292929] bg-[#151515] px-3 py-2 text-xs text-[#F5F5F5] transition-colors hover:border-red-900/60 hover:bg-red-950/30"
              >
                Stop agent
              </button>
            )}
          </div>
        </aside>

        {/* Right: VNC workspace — 70% */}
        <main className="flex min-w-0 flex-1 flex-col bg-[#0B0B0B]">
          <div className="flex shrink-0 items-center justify-between border-b border-[#292929] px-4 py-2">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-[#666666]">
                Browser
              </p>
              <div className="mt-1 flex items-center gap-2">
                <StatusDot
                  ok={vncReady}
                  label={vncReady ? 'Live' : 'Standby'}
                />
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs text-[#666666]">
              <span className="hidden font-mono sm:inline">1920×1080</span>
              <button
                type="button"
                onClick={toggleFullscreen}
                className="rounded border border-[#292929] px-2 py-1 text-[#A1A1A1] transition-colors hover:bg-[#151515] hover:text-[#F5F5F5]"
              >
                ⛶ Fullscreen
              </button>
            </div>
          </div>

          <div
            ref={vncContainerRef}
            className="relative min-h-0 flex-1 bg-black"
          >
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
                  <code className="font-mono text-amber-100/90">VNC_PASSWORD</code>, then restart dev.
                </p>
              )}
              {vncReady === false && (
                <p className="w-fit max-w-xl border border-[#292929] bg-[#151515]/95 px-3 py-2 text-[11px] text-[#A1A1A1]">
                  Display not active yet. Click <strong className="text-[#F5F5F5]">Run agent</strong>{' '}
                  — Camofox launches Firefox, then this view shows the live form.
                </p>
              )}
              {vncReady === true && (
                <p className="w-fit border border-emerald-900/40 bg-[#151515]/95 px-3 py-2 text-[11px] text-emerald-300/90">
                  Live display connected
                </p>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-between border-t border-[#292929] px-4 py-2 text-[11px] text-[#666666]">
            <StatusDot
              ok={vncReady}
              label={vncReady ? 'Connected' : 'Waiting for display'}
              muted
            />
            <span className="font-mono hidden sm:inline">noVNC · scale</span>
            <button
              type="button"
              onClick={toggleFullscreen}
              className="text-[#A1A1A1] transition-colors hover:text-[#F5F5F5] sm:hidden"
            >
              ⛶
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
