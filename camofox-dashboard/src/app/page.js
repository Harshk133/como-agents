'use client';

import { useState, useEffect, useRef, useMemo } from 'react';

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

const CAMOFOX_URL =
  process.env.NEXT_PUBLIC_CAMOFOX_URL || 'http://localhost:9377';
const VNC_BASE = process.env.NEXT_PUBLIC_VNC_URL || 'http://localhost:6080/vnc.html';
const VNC_PASSWORD = process.env.NEXT_PUBLIC_VNC_PASSWORD || '';

function buildVncSrc() {
  const params = new URLSearchParams({
    autoconnect: 'true',
    resize: 'scale',
  });
  if (VNC_PASSWORD) params.set('password', VNC_PASSWORD);
  return `${VNC_BASE}?${params.toString()}`;
}

export default function Dashboard() {
  const [logs, setLogs] = useState([]);
  const [currentPrompt, setCurrentPrompt] = useState(null);
  const [answerInput, setAnswerInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [mode, setMode] = useState('manual');
  const [backendOk, setBackendOk] = useState(null);
  const [vncReady, setVncReady] = useState(null);
  const logsEndRef = useRef(null);
  const vncSrc = useMemo(() => buildVncSrc(), []);

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
        setLogs((prev) => [...prev, { role: 'agent', text: `🤖 ${label}` }]);
      } else if (data.type === 'done') {
        setIsRunning(false);
        setCurrentPrompt(null);
        setLogs((prev) => [...prev, { role: 'system', text: data.message }]);
      } else if (data.type === 'error') {
        setIsRunning(false);
        setLogs((prev) => [...prev, { role: 'error', text: `❌ ${data.message}` }]);
      } else {
        setLogs((prev) => [...prev, { role: 'log', text: data.message }]);
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
      {
        role: 'system',
        text:
          mode === 'ai'
            ? '🚀 Starting AI mode — Ollama will answer each field autonomously.'
            : '🚀 Starting guided mode — answer each prompt below; values go into the live browser.',
      },
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
        { role: 'error', text: `❌ Failed to connect to dashboard backend: ${err.message}` },
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
      { role: 'user', text: currentPrompt?.kind === 'login' ? '✓ Continue' : value },
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
        { role: 'error', text: `❌ Failed to send answer: ${err.message}` },
      ]);
    }
  };

  const promptOptions = currentPrompt?.options;

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100 font-sans">
      {/* LEFT: Agent chat + controls */}
      <div className="w-1/2 flex flex-col border-r border-gray-800">
        <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">Form filling agent</h1>
            {backendOk === false && (
              <p className="text-red-400 text-xs mt-1">
                Cannot reach dashboard API at {BACKEND_URL} — run{' '}
                <code className="text-red-200">node dashboard-server.js</code> in the repo root.
              </p>
            )}
          </div>
          <div className="flex rounded-lg overflow-hidden border border-gray-700 text-sm">
            <button
              type="button"
              disabled={isRunning}
              onClick={() => setMode('manual')}
              className={`px-4 py-2 transition-colors ${
                mode === 'manual'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-900 text-gray-400 hover:text-white'
              } disabled:opacity-50`}
            >
              Guided
            </button>
            <button
              type="button"
              disabled={isRunning}
              onClick={() => setMode('ai')}
              className={`px-4 py-2 transition-colors ${
                mode === 'ai'
                  ? 'bg-violet-600 text-white'
                  : 'bg-gray-900 text-gray-400 hover:text-white'
              } disabled:opacity-50`}
            >
              AI (Ollama)
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-gray-950">
          {logs.length === 0 ? (
            <p className="text-gray-600 text-sm">
              Start the agent to fill the Google Form in Camofox. Watch the browser on the right.
            </p>
          ) : (
            logs.map((entry, i) => (
              <div
                key={i}
                className={`text-sm whitespace-pre-wrap break-words rounded-lg px-3 py-2 ${
                  entry.role === 'user'
                    ? 'bg-blue-950/50 text-blue-100 ml-8'
                    : entry.role === 'agent'
                      ? 'bg-gray-900 text-gray-100 mr-8'
                      : entry.role === 'error'
                        ? 'bg-red-950/40 text-red-300'
                        : 'text-green-400/90 font-mono text-xs'
                }`}
              >
                {entry.text}
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>

        <div className="p-6 bg-gray-900 border-t border-gray-800">
          {currentPrompt ? (
            <div className="space-y-4">
              <div className="bg-blue-900/30 border border-blue-700/50 p-4 rounded-lg">
                <h3 className="text-blue-300 font-semibold mb-1">
                  {currentPrompt.kind === 'login'
                    ? 'Sign in required'
                    : 'Answer for the form'}
                </h3>
                <p className="text-white text-lg">{currentPrompt.question}</p>
                {currentPrompt.fieldType && (
                  <p className="text-gray-400 text-xs mt-2 uppercase tracking-wide">
                    Field type: {currentPrompt.fieldType}
                  </p>
                )}
                {promptOptions?.length ? (
                  <ul className="mt-3 space-y-1 text-sm text-gray-300">
                    {promptOptions.map((opt) => (
                      <li key={opt.ref || opt.index}>
                        <span className="text-blue-400 font-mono">{opt.index}.</span>{' '}
                        {opt.label}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {currentPrompt.hint && (
                  <p className="text-gray-500 text-xs mt-2">{currentPrompt.hint}</p>
                )}
              </div>
              {currentPrompt.kind === 'login' ? (
                <button
                  type="button"
                  onClick={submitAnswer}
                  className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-bold transition-colors"
                >
                  Continue after login
                </button>
              ) : (
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={answerInput}
                    onChange={(e) => setAnswerInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && submitAnswer()}
                    placeholder="Type your answer (or skip)..."
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={submitAnswer}
                    className="px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-bold transition-colors"
                  >
                    Submit
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-gray-500 mb-4 text-sm">
                {isRunning
                  ? mode === 'ai'
                    ? 'AI is filling the form — follow progress in the log above.'
                    : 'Waiting for the next question…'
                  : 'Camofox must be running with VNC (port 6080) and API (port 9377).'}
              </p>
              <div className="flex gap-3 justify-center flex-wrap">
                <button
                  type="button"
                  onClick={runAgent}
                  disabled={isRunning}
                  className="px-8 py-3 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg font-bold text-lg transition-all"
                >
                  {isRunning ? 'Running…' : '▶ Start form filling'}
                </button>
                {isRunning && (
                  <button
                    type="button"
                    onClick={stopAgent}
                    className="px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg font-semibold transition-colors"
                  >
                    Stop
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: Live Camofox via noVNC */}
      <div className="w-1/2 flex flex-col p-4 bg-gray-900">
        <h2 className="text-sm font-semibold mb-2 flex items-center gap-2 text-gray-300">
          <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
          Live browser (Camofox + noVNC)
        </h2>
        <div className="flex-1 bg-black rounded-xl overflow-hidden border border-gray-800 shadow-inner relative min-h-0">
          <iframe
            src={vncSrc}
            title="Camofox live browser"
            className="w-full h-full border-none"
            allow="clipboard-read; clipboard-write"
          />
          <div className="absolute top-2 left-2 right-2 pointer-events-none space-y-1">
            {!VNC_PASSWORD && (
              <p className="bg-amber-950/90 border border-amber-700/60 text-amber-200 text-xs px-3 py-2 rounded">
                Add <code className="text-amber-100">NEXT_PUBLIC_VNC_PASSWORD</code> in{' '}
                <code className="text-amber-100">.env.local</code> to match Docker{' '}
                <code className="text-amber-100">VNC_PASSWORD</code>, then restart{' '}
                <code className="text-amber-100">npm run dev</code>.
              </p>
            )}
            {vncReady === false && (
              <p className="bg-gray-900/90 text-gray-300 text-xs px-3 py-2 rounded">
                noVNC is up but the browser display is not active yet. Click{' '}
                <strong className="text-white">Start form filling</strong> on the left — Camofox
                launches Firefox, then this panel shows the live form.
              </p>
            )}
            {vncReady === true && (
              <p className="bg-emerald-950/80 text-emerald-200 text-xs px-3 py-2 rounded w-fit">
                Live display connected
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
