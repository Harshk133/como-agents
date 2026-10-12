'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import QRCode from 'qrcode';

// Same-origin proxy (src/app/api/phone-bridge) -> Camofox phone-bridge plugin.
const API = '/api/phone-bridge';
const POLL_MS = 2000;
const STORAGE_KEY = 'phone-bridge-desktop';

const SESSION_LABELS = {
  waiting: 'Waiting for phone',
  paired: 'Phone connected',
  expired: 'Session expired',
  revoked: 'Disconnected',
};

const FILE_LABELS = {
  received: 'File received',
  attaching: 'Attaching file',
  attached: 'Attachment completed',
  failed: 'Failed',
};

function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

function fmtCountdown(ms) {
  if (ms <= 0) return '0:00';
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function isActive(status) {
  return status === 'waiting' || status === 'paired';
}

function readSaved() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSaved(value) {
  try {
    if (value) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable: the session just won't survive a reload */
  }
}

async function bridgeFetch(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Phone-Bridge-Token': token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (HTTP ${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function StatusPill({ status, uploading }) {
  const label = uploading ? 'Uploading…' : SESSION_LABELS[status] || status;
  const tone =
    status === 'paired'
      ? 'border-emerald-900/50 bg-emerald-950/40 text-emerald-400/90'
      : status === 'waiting'
        ? 'border-[#7C3AED]/40 bg-[#7C3AED]/10 text-[#A78BFA]'
        : 'border-[#292929] bg-[#151515] text-[#666666]';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] ${tone}`}>
      <span
        className={`h-1.5 w-1.5 rounded-full ${status === 'paired' ? 'bg-emerald-400' : status === 'waiting' ? 'animate-pulse bg-[#8B5CF6]' : 'bg-[#666666]'}`}
      />
      {label}
    </span>
  );
}

function AttachPicker({ session, file, onAttached, onRefresh, onCancel }) {
  const [targets, setTargets] = useState(null);
  const [tabId, setTabId] = useState('');
  const [inputIndex, setInputIndex] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const { sessionId, desktopToken } = session;

  const applyTargets = (list) => {
    setError(null);
    setTargets(list);
    const preferred = list.find((t) => t.inputs.length) || list[0];
    setTabId(preferred?.tabId || '');
    setInputIndex(preferred?.inputs.length ? preferred.inputs[0].index : null);
  };
  const failTargets = (err) => {
    setError(err.message);
    setTargets([]);
  };
  const fetchTargets = () =>
    bridgeFetch(`/sessions/${sessionId}/targets`, { token: desktopToken }).then((data) => data.targets);

  useEffect(() => {
    let cancelled = false;
    bridgeFetch(`/sessions/${sessionId}/targets`, { token: desktopToken })
      .then((data) => {
        if (cancelled) return;
        setTargets(data.targets);
        const preferred = data.targets.find((t) => t.inputs.length) || data.targets[0];
        setTabId(preferred?.tabId || '');
        setInputIndex(preferred?.inputs.length ? preferred.inputs[0].index : null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setTargets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, desktopToken]);

  const reload = () => {
    setTargets(null);
    setError(null);
    fetchTargets().then(applyTargets, failTargets);
  };

  const tab = targets?.find((t) => t.tabId === tabId);
  const chosenInput = tab?.inputs.find((i) => i.index === inputIndex);

  const attach = async () => {
    setBusy(true);
    setError(null);
    try {
      await bridgeFetch(`/sessions/${session.sessionId}/files/${file.id}/attach`, {
        method: 'POST',
        token: session.desktopToken,
        body: { tabId, ...(inputIndex !== null ? { inputIndex } : {}) },
      });
      onAttached();
    } catch (err) {
      setError(err.message);
      setBusy(false);
      onRefresh();
    }
  };

  return (
    <div className="mt-2 rounded-lg border border-[#292929] bg-[#0B0B0B] p-2.5">
      {targets === null ? (
        <p className="text-[11px] text-[#666666]">Finding upload fields in the browser…</p>
      ) : targets.length === 0 ? (
        <p className="text-[11px] text-[#A1A1A1]">No open tabs in this browser session yet.</p>
      ) : (
        <>
          {targets.length > 1 ? (
            <label className="mb-2 block text-[10px] uppercase tracking-wide text-[#666666]">
              Tab
              <select
                value={tabId}
                onChange={(e) => {
                  setTabId(e.target.value);
                  const next = targets.find((t) => t.tabId === e.target.value);
                  setInputIndex(next?.inputs.length ? next.inputs[0].index : null);
                }}
                className="mt-1 block w-full rounded-md border border-[#292929] bg-[#151515] px-2 py-1 text-[12px] normal-case tracking-normal text-[#F5F5F5]"
              >
                {targets.map((t) => (
                  <option key={t.tabId} value={t.tabId}>
                    {t.title || t.url}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="mb-2 truncate text-[11px] text-[#666666]" title={tab?.url}>
              {tab?.title || tab?.url}
            </p>
          )}

          {tab?.inputs.length ? (
            <fieldset className="space-y-1">
              <legend className="mb-1 text-[10px] uppercase tracking-wide text-[#666666]">Upload field</legend>
              {tab.inputs.map((input) => (
                <label
                  key={input.index}
                  className={`flex cursor-pointer items-start gap-2 rounded-md border px-2 py-1.5 text-[12px] ${inputIndex === input.index ? 'border-[#7C3AED]/60 bg-[#7C3AED]/10 text-[#F5F5F5]' : 'border-[#222222] text-[#A1A1A1] hover:border-[#333333]'}`}
                >
                  <input
                    type="radio"
                    name={`input-${file.id}`}
                    checked={inputIndex === input.index}
                    onChange={() => setInputIndex(input.index)}
                    className="mt-0.5 accent-[#7C3AED]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{input.label}</span>
                    <span className="block text-[10px] text-[#666666]">
                      {[input.accept && `accepts ${input.accept}`, !input.visible && 'hidden field', input.disabled && 'disabled']
                        .filter(Boolean)
                        .join(' · ') || 'file input'}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : (
            <p className="text-[11px] leading-relaxed text-[#A1A1A1]">
              No standard file upload field on this page. Open the form&apos;s upload step in the browser, then
              refresh. Custom upload widgets may not be supported.
            </p>
          )}
        </>
      )}

      {error ? <p className="mt-2 text-[11px] text-red-300/90">{error}</p> : null}

      <div className="mt-2.5 flex items-center gap-1.5">
        <button
          type="button"
          disabled={busy || !tab || !chosenInput}
          onClick={attach}
          className="flex-1 rounded-md bg-[#7C3AED] px-2 py-1.5 text-[11px] font-medium text-white hover:bg-[#8B5CF6] disabled:bg-[#292929] disabled:text-[#666666]"
        >
          {busy ? 'Attaching…' : chosenInput ? `Attach to “${chosenInput.label.slice(0, 28)}”` : 'Attach'}
        </button>
        <button
          type="button"
          onClick={reload}
          disabled={busy}
          className="rounded-md border border-[#292929] px-2 py-1.5 text-[11px] text-[#A1A1A1] hover:text-[#F5F5F5]"
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md px-2 py-1.5 text-[11px] text-[#666666] hover:text-[#A1A1A1]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function FileCard({ session, file, onChange }) {
  const [picking, setPicking] = useState(false);
  const [removing, setRemoving] = useState(false);
  const active = isActive(session.status);

  const remove = async () => {
    setRemoving(true);
    try {
      await bridgeFetch(`/sessions/${session.sessionId}/files/${file.id}`, {
        method: 'DELETE',
        token: session.desktopToken,
      });
    } catch {
      /* next poll shows the real state */
    }
    onChange();
  };

  const tone =
    file.status === 'attached'
      ? 'text-emerald-400/90'
      : file.status === 'failed'
        ? 'text-red-300/90'
        : file.status === 'attaching'
          ? 'text-[#A78BFA]'
          : 'text-[#A1A1A1]';

  return (
    <li className="rounded-xl border border-[#292929] bg-[#111111] px-3 py-2.5">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#1A1A1A] font-mono text-[9px] text-[#A1A1A1]">
          {file.type === 'application/pdf' ? 'PDF' : 'IMG'}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] text-[#F5F5F5]" title={file.name}>
            {file.name}
          </p>
          <p className="text-[10px] text-[#666666]">
            {fmtSize(file.size)} · <span className={tone}>{FILE_LABELS[file.status] || file.status}</span>
          </p>
        </div>
      </div>

      {file.status === 'failed' && file.error ? (
        <p className="mt-1.5 text-[11px] leading-snug text-red-300/80">{file.error}</p>
      ) : null}
      {file.status === 'attached' ? (
        <p className="mt-1.5 text-[11px] leading-snug text-[#A1A1A1]">
          Check the attachment in the browser before you submit. Nothing was submitted automatically.
        </p>
      ) : null}

      {picking ? (
        <AttachPicker
          session={session}
          file={file}
          onCancel={() => setPicking(false)}
          onRefresh={onChange}
          onAttached={() => {
            setPicking(false);
            onChange();
          }}
        />
      ) : active ? (
        <div className="mt-2 flex gap-1.5">
          <button
            type="button"
            disabled={file.status === 'attaching'}
            onClick={() => setPicking(true)}
            className="rounded-md bg-[#7C3AED] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[#8B5CF6] disabled:bg-[#292929] disabled:text-[#666666]"
          >
            {file.status === 'attached' || file.status === 'failed' ? 'Attach again' : 'Attach'}
          </button>
          <button
            type="button"
            disabled={removing || file.status === 'attaching'}
            onClick={remove}
            className="rounded-md border border-[#292929] px-2.5 py-1 text-[11px] text-[#A1A1A1] hover:border-red-900/50 hover:text-red-300/90"
          >
            {removing ? 'Removing…' : 'Remove'}
          </button>
        </div>
      ) : null}
    </li>
  );
}

export default function PhoneBridgePanel() {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(null);
  const [qr, setQr] = useState(null);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const sessionRef = useRef(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const status = session?.status;
  const active = isActive(status);
  const newFiles = session?.files?.filter((f) => f.status === 'received').length || 0;

  const refresh = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return;
    try {
      const data = await bridgeFetch(`/sessions/${current.sessionId}`, { token: current.desktopToken });
      setSession((prev) => (prev && prev.sessionId === data.sessionId ? { ...prev, ...data } : prev));
      setError(null);
    } catch (err) {
      if (err.status === 404) {
        setSession((prev) => (prev ? { ...prev, status: 'expired', files: [] } : prev));
        writeSaved(null);
      } else {
        setError(err.message);
      }
    }
  }, []);

  // Resume a pairing across a dashboard reload (same browser tab only).
  useEffect(() => {
    const saved = readSaved();
    if (!saved?.sessionId || !saved?.desktopToken) return;
    bridgeFetch(`/sessions/${saved.sessionId}`, { token: saved.desktopToken })
      .then((data) => {
        if (isActive(data.status)) setSession((prev) => prev || { ...saved, ...data });
        else writeSaved(null);
      })
      .catch(() => writeSaved(null));
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [active, refresh]);

  useEffect(() => {
    if (!open || !active) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open, active]);

  const pairUrl = session?.pairUrl;
  useEffect(() => {
    if (!pairUrl || status !== 'waiting') return undefined;
    let cancelled = false;
    QRCode.toDataURL(pairUrl, { margin: 1, width: 232, errorCorrectionLevel: 'M' })
      .then((image) => {
        if (!cancelled) setQr({ forUrl: pairUrl, image });
      })
      .catch(() => {
        if (!cancelled) setError('Could not draw the QR code — use the link below instead.');
      });
    return () => {
      cancelled = true;
    };
  }, [pairUrl, status]);
  // Only show a QR drawn for the current pairing URL.
  const qrImage = status === 'waiting' && qr?.forUrl === pairUrl ? qr.image : null;

  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      const prev = sessionRef.current;
      if (prev && isActive(prev.status)) {
        await bridgeFetch(`/sessions/${prev.sessionId}`, { method: 'DELETE', token: prev.desktopToken }).catch(() => {});
      }
      const data = await bridgeFetch('/sessions', { method: 'POST', body: {} });
      setSession(data);
      setNow(Date.now());
      writeSaved({ sessionId: data.sessionId, desktopToken: data.desktopToken, pairUrl: data.pairUrl });
    } catch (err) {
      setError(
        err.status === 403 || err.status === 401
          ? 'Camofox refused the request. Set CAMOFOX_ACCESS_KEY (or CAMOFOX_API_KEY) for the dashboard server.'
          : err.message,
      );
    } finally {
      setCreating(false);
    }
  };

  const disconnect = async () => {
    const current = sessionRef.current;
    if (!current) return;
    try {
      await bridgeFetch(`/sessions/${current.sessionId}`, { method: 'DELETE', token: current.desktopToken });
    } catch {
      /* already gone */
    }
    writeSaved(null);
    setSession(null);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(session.pairUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Copy failed — select the link manually.');
    }
  };

  const openPanel = () => {
    setOpen(true);
    if (!sessionRef.current || !isActive(sessionRef.current.status)) create();
  };

  const localOnly = (() => {
    try {
      const host = new URL(session?.pairUrl || '').hostname;
      return host === 'localhost' || host === '127.0.0.1' || host === '::1';
    } catch {
      return false;
    }
  })();

  const countdown =
    status === 'waiting'
      ? `QR expires in ${fmtCountdown(session.pairingExpiresAt - now)}`
      : status === 'paired'
        ? `Session ends in ${fmtCountdown(session.expiresAt - now)}`
        : null;

  return (
    <>
      <button
        type="button"
        onClick={openPanel}
        className="relative rounded border border-[#292929] px-2 py-1 text-xs text-[#A1A1A1] transition-colors hover:bg-[#151515] hover:text-[#F5F5F5]"
      >
        Send files from phone
        {newFiles ? (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#7C3AED] px-1 text-[9px] font-medium text-white">
            {newFiles}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Send files from phone"
          className="absolute right-3 top-12 z-30 flex max-h-[calc(100%-4rem)] w-[340px] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-2xl border border-[#292929] bg-[#0B0B0B]/98 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)]"
        >
          <div className="flex items-center justify-between gap-2 border-b border-[#292929] px-4 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-[#F5F5F5]">Send files from phone</p>
              {session ? (
                <div className="mt-1 flex items-center gap-2">
                  <StatusPill status={status} uploading={session.uploadsInProgress > 0} />
                  {countdown ? <span className="font-mono text-[10px] text-[#666666]">{countdown}</span> : null}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="rounded-md px-2 py-1 text-[#666666] hover:text-[#F5F5F5]"
            >
              ✕
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {creating && !session ? <p className="text-[12px] text-[#666666]">Creating a secure pairing…</p> : null}

            {status === 'waiting' ? (
              <div className="flex flex-col items-center text-center">
                <div className="rounded-xl bg-white p-2">
                  {qrImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={qrImage} alt="Pairing QR code" width={232} height={232} className="block h-[200px] w-[200px]" />
                  ) : (
                    <div className="h-[200px] w-[200px]" />
                  )}
                </div>
                <p className="mt-3 text-[12px] leading-relaxed text-[#A1A1A1]">
                  Scan with your phone&apos;s camera, then tap <b className="text-[#F5F5F5]">Pair this phone</b>. Check
                  the phone shows code
                </p>
                <p className="mt-1 font-mono text-lg tracking-[0.2em] text-[#8B5CF6]">{session.code}</p>
                <div className="mt-2 flex w-full gap-1.5">
                  <button
                    type="button"
                    onClick={copyLink}
                    className="flex-1 rounded-md border border-[#292929] px-2 py-1.5 text-[11px] text-[#A1A1A1] hover:text-[#F5F5F5]"
                  >
                    {copied ? 'Copied' : 'Copy link'}
                  </button>
                  <a
                    href={session.pairUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex-1 rounded-md border border-[#292929] px-2 py-1.5 text-[11px] text-[#A1A1A1] hover:text-[#F5F5F5]"
                  >
                    Open link
                  </a>
                </div>
                {localOnly ? (
                  <p className="mt-2 rounded-md border border-amber-900/50 bg-amber-950/20 px-2 py-1.5 text-left text-[10px] leading-snug text-amber-200/90">
                    This link points at localhost, which your phone cannot reach. Set{' '}
                    <code className="font-mono">PHONE_BRIDGE_PUBLIC_URL</code> on the Camofox server to its LAN or
                    HTTPS address.
                  </p>
                ) : null}
              </div>
            ) : null}

            {status === 'paired' ? (
              <div>
                <p className="text-[12px] leading-relaxed text-[#A1A1A1]">
                  Choose files on your phone and tap <b className="text-[#F5F5F5]">Send files</b>. They appear here —
                  pick one to attach to the form in the browser.
                </p>
                {session.uploadsInProgress > 0 ? (
                  <p className="mt-2 text-[11px] text-[#A78BFA]">Receiving {session.uploadsInProgress} file(s)…</p>
                ) : null}
              </div>
            ) : null}

            {status === 'expired' || status === 'revoked' ? (
              <p className="text-[12px] leading-relaxed text-[#A1A1A1]">
                {status === 'expired'
                  ? 'This pairing expired and its files were deleted.'
                  : 'The phone was disconnected and its files were deleted.'}
              </p>
            ) : null}

            {session?.files?.length ? (
              <ul className="mt-3 space-y-2">
                {session.files.map((file) => (
                  <FileCard key={file.id} session={session} file={file} onChange={refresh} />
                ))}
              </ul>
            ) : null}

            {error ? (
              <p className="mt-3 rounded-md border border-red-900/40 bg-red-950/25 px-2 py-1.5 text-[11px] text-red-200/90">
                {error}
              </p>
            ) : null}
          </div>

          <div className="flex gap-1.5 border-t border-[#292929] px-4 py-2.5">
            <button
              type="button"
              onClick={create}
              disabled={creating}
              className="flex-1 rounded-md border border-[#292929] px-2 py-1.5 text-[11px] text-[#A1A1A1] hover:text-[#F5F5F5] disabled:opacity-50"
            >
              {creating ? 'Generating…' : active ? 'New QR code' : 'Generate QR code'}
            </button>
            {active ? (
              <button
                type="button"
                onClick={disconnect}
                className="flex-1 rounded-md border border-[#292929] px-2 py-1.5 text-[11px] text-[#A1A1A1] hover:border-red-900/50 hover:text-red-300/90"
              >
                {status === 'paired' ? 'Disconnect phone' : 'Cancel'}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
