/**
 * Phone-bridge plugin for camofox-browser.
 *
 * Lets a user send documents from their phone into a Camofox browser session
 * and attach them to a file input on the page:
 *
 *   desktop creates pairing -> QR (pairing URL) -> phone confirms pairing ->
 *   phone uploads files -> desktop polls and sees them -> desktop attaches one
 *   to a tab's <input type=file> via the core POST /tabs/:tabId/upload route.
 *
 * Credentials (all 256-bit random, stored only as SHA-256 hashes):
 *   desktopToken  returned once at creation; required (X-Phone-Bridge-Token)
 *                 on every desktop route, in addition to the usual Camofox
 *                 API/access key gate (ctx.auth()).
 *   pairingToken  carried in the QR URL fragment; single use, short TTL.
 *   phoneToken    issued when the phone confirms; can only upload to, report
 *                 on, or disconnect its own session -- never browser control.
 *
 * Phone routes (/phone-bridge/m, /phone-bridge/phone/*) are exempt from the
 * global CAMOFOX_ACCESS_KEY gate (see lib/auth.js) because a phone cannot hold
 * that key; they authenticate with the pairing/phone tokens instead.
 *
 * Files live under <CAMOFOX_UPLOADS_DIR>/phone-bridge/ (the core upload route
 * only accepts paths inside the uploads dir) and are deleted when the session
 * is revoked or expires, including sessions left over from before a restart.
 *
 * Desktop routes:
 *   POST   /phone-bridge/sessions                              create pairing
 *   GET    /phone-bridge/sessions/:id                          status + received files
 *   GET    /phone-bridge/sessions/:id/targets                  tabs + file inputs for attach
 *   POST   /phone-bridge/sessions/:id/files/:fileId/attach     attach to a tab's file input
 *   DELETE /phone-bridge/sessions/:id/files/:fileId            discard a file
 *   DELETE /phone-bridge/sessions/:id                          revoke session
 * Phone routes:
 *   GET    /phone-bridge/m                                     upload page
 *   POST   /phone-bridge/phone/preview                         pairing code for confirmation
 *   POST   /phone-bridge/phone/pair                            confirm pairing -> phoneToken
 *   GET    /phone-bridge/phone/status                          session status + limits
 *   POST   /phone-bridge/phone/files                           upload one file (raw body)
 *   POST   /phone-bridge/phone/disconnect                      end the session
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createBridgeStore, fileView, isValidId } from './store.js';
import {
  ALLOWED_TYPES, SNIFF_BYTES, sniffType, describeRejectedType, extensionOf, sanitizeFilename,
} from './file-type.js';
import { createRateLimiter, clientKey } from './rate-limit.js';
import { renderMobilePage } from './mobile-page.js';
import { attachThroughPicker } from './picker-upload.js';

const TOKEN_HEADER = 'x-phone-bridge-token';
const SWEEP_INTERVAL_MS = 30 * 1000;
const UPLOAD_TIMEOUT_MS = 2 * 60 * 1000;
const ATTACH_TIMEOUT_MS = 30 * 1000;
const INPUT_SCAN_TIMEOUT_MS = 3000;
const MAX_ACTIVE_SESSIONS = 200;

const SENSITIVE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

function noStore(req, res, next) {
  res.set(SENSITIVE_HEADERS);
  next();
}

function tokenFrom(req) {
  const value = req.get(TOKEN_HEADER);
  return typeof value === 'string' ? value.trim() : '';
}

function withTimeout(promise, ms, fallback) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/** Runs in the page: describe every file input, in Playwright locator order. */
function describeFileInputs(elements) {
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return elements.map((el, index) => {
    let label = '';
    if (el.labels && el.labels.length) label = el.labels[0].innerText;
    if (!label) label = el.getAttribute('aria-label') || '';
    if (!label) {
      const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
      label = ids.map((id) => document.getElementById(id)?.innerText || '').join(' ');
    }
    if (!label) {
      let parent = el.parentElement;
      for (let i = 0; i < 4 && parent && !label; i++, parent = parent.parentElement) {
        label = parent.innerText || '';
      }
    }
    const rect = el.getBoundingClientRect();
    return {
      index,
      label: clean(label) || clean(el.name) || clean(el.id) || `File input ${index + 1}`,
      name: clean(el.name),
      accept: clean(el.accept),
      multiple: Boolean(el.multiple),
      disabled: Boolean(el.disabled),
      visible: rect.width > 0 && rect.height > 0,
    };
  });
}

export async function register(app, ctx, pluginConfig = {}) {
  const { config, log, sessions, normalizeUserId, safeError, events } = ctx;
  const settings = ctx.plugin?.settings || pluginConfig;
  const envCfg = config.phoneBridge || {};
  const pick = (key) => envCfg[key] ?? settings[key];

  const store = createBridgeStore({
    rootDir: path.join(config.uploadsDir, 'phone-bridge'),
    log,
    limits: {
      pairingTtlMs: pick('pairingTtlMs'),
      sessionTtlMs: pick('sessionTtlMs'),
      maxFileBytes: pick('maxFileBytes'),
      maxFiles: pick('maxFiles'),
    },
  });
  await store.init();
  const { limits } = store;

  const trustProxy = Boolean(envCfg.trustProxy ?? settings.trustProxy);
  const publicUrl = String(envCfg.publicUrl || settings.publicUrl || '').replace(/\/+$/, '');
  if (!publicUrl && config.nodeEnv === 'production') {
    log('warn', 'phone-bridge: PHONE_BRIDGE_PUBLIC_URL is not set; QR links will use the request host');
  }

  const createLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 20 });
  const pairLimiter = createRateLimiter({ windowMs: 5 * 60 * 1000, max: 30 });
  const uploadLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 60 });
  const authFailLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 20 });
  const inflight = new Map(); // sessionId -> uploads in progress

  const keyOf = (req) => clientKey(req, { trustProxy });

  function tooMany(res, retryAfterSec) {
    res.set('Retry-After', String(retryAfterSec || 60));
    return res.status(429).json({ error: 'Too many attempts. Please wait a minute and try again.' });
  }

  function limitsView(session) {
    const used = (session.uploadCount || 0) + (inflight.get(session.id) || 0);
    const maxFiles = session.maxFiles || limits.maxFiles;
    return {
      maxFileBytes: limits.maxFileBytes,
      maxFiles,
      remainingFiles: Math.max(0, maxFiles - used),
      allowedTypes: Object.keys(ALLOWED_TYPES),
    };
  }

  function sessionView(session) {
    return {
      sessionId: session.id,
      status: store.effectiveStatus(session),
      code: session.code,
      purpose: session.purpose || '',
      createdAt: session.createdAt,
      pairingExpiresAt: session.pairingExpiresAt,
      expiresAt: session.expiresAt,
      pairedAt: session.pairedAt,
      endedAt: session.endedAt,
      endReason: session.endReason || null,
      uploadsInProgress: inflight.get(session.id) || 0,
      files: session.files.map(fileView),
      limits: limitsView(session),
    };
  }

  function baseUrl(req) {
    if (publicUrl) return publicUrl;
    const proto = trustProxy ? (req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim() : req.protocol;
    const host = trustProxy ? (req.get('x-forwarded-host') || req.get('host')) : req.get('host');
    return `${proto}://${host}`;
  }

  // --- auth middlewares ---------------------------------------------------

  function desktopSession(req, res, next) {
    const key = keyOf(req);
    if (authFailLimiter.blocked(key)) return tooMany(res, 600);
    const session = store.getForDesktop(req.params.id, tokenFrom(req));
    if (!session) {
      authFailLimiter.hit(key);
      return res.status(404).json({ error: 'Phone pairing session not found' });
    }
    req.bridgeSession = session;
    next();
  }

  function phoneSession(req, res, next) {
    const key = keyOf(req);
    if (authFailLimiter.blocked(key)) return tooMany(res, 600);
    const session = store.getForPhoneToken(tokenFrom(req));
    if (!session) {
      authFailLimiter.hit(key);
      return res.status(401).json({ error: 'This phone is no longer paired. Scan a new QR code.' });
    }
    req.bridgeSession = session;
    next();
  }

  function requireActive(req, res, next) {
    const status = store.effectiveStatus(req.bridgeSession);
    if (status !== 'paired' && status !== 'waiting') {
      return res.status(410).json({ error: `Session ${status}`, status });
    }
    next();
  }

  const desktop = [ctx.auth(), noStore, desktopSession];

  /** Find a tab owned by this pairing's browser session (userId). */
  function findOwnedTab(session, tabId) {
    const browserSession = sessions.get(normalizeUserId(session.userId));
    if (!browserSession?.tabGroups) return null;
    for (const group of browserSession.tabGroups.values()) {
      if (group.has(tabId)) return group.get(tabId);
    }
    return null;
  }

  /** Attach via the core upload route so tab locks and upload strategies are shared. */
  async function attachViaCore({ tabId, userId, filePath, selector }) {
    const bind = String(config.bindHost || '');
    const host = !bind || bind === '0.0.0.0' || bind === '::' ? '127.0.0.1' : bind;
    const headers = { 'Content-Type': 'application/json' };
    const key = config.accessKey || config.apiKey;
    if (key) headers.Authorization = `Bearer ${key}`;
    const res = await fetch(`http://${host.includes(':') ? `[${host}]` : host}:${config.port}/tabs/${encodeURIComponent(tabId)}/upload`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ userId, path: filePath, ...(selector ? { selector } : {}) }),
      signal: AbortSignal.timeout(ATTACH_TIMEOUT_MS),
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  // --- phone page + phone API ---------------------------------------------

  app.get('/phone-bridge/m', (req, res) => {
    const nonce = crypto.randomBytes(16).toString('base64');
    res.set({
      ...SENSITIVE_HEADERS,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': [
        "default-src 'none'",
        `script-src 'nonce-${nonce}'`,
        `style-src 'nonce-${nonce}'`,
        "connect-src 'self'",
        "img-src 'self' data:",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ].join('; '),
      'X-Frame-Options': 'DENY',
      'X-Robots-Tag': 'noindex',
    });
    res.send(renderMobilePage({ nonce }));
  });

  app.post('/phone-bridge/phone/preview', noStore, (req, res) => {
    const key = keyOf(req);
    const rl = pairLimiter.hit(key);
    if (!rl.allowed || authFailLimiter.blocked(key)) return tooMany(res, rl.retryAfterSec);
    const session = store.getForPairingToken(req.body?.pairingToken);
    if (!session) {
      authFailLimiter.hit(key);
      return res.status(404).json({ error: 'This QR code has expired or was already used.' });
    }
    res.json({ code: session.code, purpose: session.purpose || '', pairingExpiresAt: session.pairingExpiresAt });
  });

  app.post('/phone-bridge/phone/pair', noStore, async (req, res) => {
    const key = keyOf(req);
    const rl = pairLimiter.hit(key);
    if (!rl.allowed || authFailLimiter.blocked(key)) return tooMany(res, rl.retryAfterSec);
    if (req.body?.confirm !== true) {
      return res.status(400).json({ error: 'Pairing must be confirmed on the phone (confirm: true).' });
    }
    const session = store.getForPairingToken(req.body?.pairingToken);
    if (!session) {
      authFailLimiter.hit(key);
      return res.status(404).json({ error: 'This QR code has expired or was already used.' });
    }
    try {
      const phoneToken = await store.pair(session);
      log('info', 'phone-bridge: phone paired', { sessionId: session.id });
      res.json({
        phoneToken, code: session.code, purpose: session.purpose || '', expiresAt: session.expiresAt, limits: limitsView(session),
      });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: safeError(err) });
    }
  });

  app.get('/phone-bridge/phone/status', noStore, phoneSession, (req, res) => {
    const session = req.bridgeSession;
    res.json({
      status: store.effectiveStatus(session),
      code: session.code,
      purpose: session.purpose || '',
      expiresAt: session.expiresAt,
      filesReceived: session.files.length,
      limits: limitsView(session),
    });
  });

  app.post('/phone-bridge/phone/disconnect', noStore, phoneSession, async (req, res) => {
    await store.revoke(req.bridgeSession, 'phone_disconnect');
    res.json({ ok: true });
  });

  app.post('/phone-bridge/phone/files', noStore, phoneSession, async (req, res) => {
    const session = req.bridgeSession;
    const reject = (status, error) => {
      // Stop reading a body we are refusing; the client sees the JSON error.
      res.set('Connection', 'close');
      res.status(status).json({ error });
    };

    const rl = uploadLimiter.hit(keyOf(req));
    if (!rl.allowed) return tooMany(res, rl.retryAfterSec);

    const contentType = String(req.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (contentType !== 'application/octet-stream') {
      return reject(415, 'Send the file as application/octet-stream.');
    }
    if (!req.get('content-length')) return reject(411, 'Content-Length is required.');
    const declared = Number(req.get('content-length'));
    if (!Number.isSafeInteger(declared) || declared <= 0) return reject(400, 'The file is empty.');
    if (declared > limits.maxFileBytes) {
      return reject(413, `File is too large (max ${Math.round(limits.maxFileBytes / 1048576)} MB).`);
    }
    if (limitsView(session).remainingFiles <= 0) {
      return reject(409, `File limit reached (${limitsView(session).maxFiles} for this request).`);
    }

    let rawName = '';
    try {
      rawName = decodeURIComponent(String(req.get('x-file-name') || ''));
    } catch {
      return reject(400, 'Invalid file name.');
    }

    inflight.set(session.id, (inflight.get(session.id) || 0) + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const left = (inflight.get(session.id) || 1) - 1;
      if (left > 0) inflight.set(session.id, left);
      else inflight.delete(session.id);
    };
    const incoming = store.incomingDir(session.id);
    const partPath = path.join(incoming, `${store.newUploadId()}.part`);
    let received = 0;
    let head = Buffer.alloc(0);
    let tooLarge = false;

    try {
      await fsp.mkdir(incoming, { recursive: true, mode: 0o700 });
      req.setTimeout(UPLOAD_TIMEOUT_MS, () => req.destroy(new Error('upload timed out')));
      const meter = new Transform({
        transform(chunk, _enc, cb) {
          received += chunk.length;
          if (received > declared || received > limits.maxFileBytes) {
            tooLarge = true;
            return cb(new Error('body exceeds declared size'));
          }
          if (head.length < SNIFF_BYTES) head = Buffer.concat([head, chunk.subarray(0, SNIFF_BYTES - head.length)]);
          cb(null, chunk);
        },
      });
      await pipeline(req, meter, fs.createWriteStream(partPath, { flags: 'wx', mode: 0o600 }));

      if (received !== declared) return reject(400, 'Upload was incomplete. Please retry.');

      const type = sniffType(head);
      if (!type) {
        const known = describeRejectedType(head);
        return reject(415, known
          ? `${known}s are not supported. Choose a JPEG, PNG, WebP or PDF.`
          : 'Unsupported file type. Choose a PDF, JPEG, PNG or WebP file.');
      }
      const allowedExt = ALLOWED_TYPES[type].extensions;
      const ext = extensionOf(rawName);
      if (ext && !allowedExt.includes(ext)) {
        return reject(415, `The file content (${ALLOWED_TYPES[type].label}) does not match its .${ext} extension.`);
      }
      let name = sanitizeFilename(rawName, allowedExt[0]);
      if (!allowedExt.includes(extensionOf(name))) name = `${name}.${allowedExt[0]}`;

      // The session may have been revoked or expired while bytes were arriving.
      if (store.effectiveStatus(session) !== 'paired') return reject(410, 'This session has ended.');

      const fileId = store.newFileId();
      const fileDir = path.join(store.filesDir(session.id), fileId);
      await fsp.mkdir(fileDir, { recursive: true, mode: 0o700 });
      await fsp.rename(partPath, path.join(fileDir, name));

      const file = {
        id: fileId,
        name,
        storedName: name,
        type,
        size: received,
        status: 'received',
        createdAt: Date.now(),
      };
      session.uploadCount = (session.uploadCount || 0) + 1;
      release();
      await store.addFile(session, file);
      log('info', 'phone-bridge: file received', { sessionId: session.id, fileId, type, size: received });
      return res.status(201).json({ file: fileView(file), limits: limitsView(session) });
    } catch (err) {
      if (tooLarge) return reject(413, `File is too large (max ${Math.round(limits.maxFileBytes / 1048576)} MB).`);
      log('warn', 'phone-bridge: upload failed', { sessionId: session.id, error: err.message });
      if (!res.headersSent && !req.destroyed) return reject(400, 'Upload failed. Please retry.');
    } finally {
      release();
      await fsp.rm(partPath, { force: true }).catch(() => {});
    }
  });

  // --- desktop API ------------------------------------------------------

  app.post('/phone-bridge/sessions', ctx.auth(), noStore, async (req, res) => {
    const rl = createLimiter.hit(keyOf(req));
    if (!rl.allowed) return tooMany(res, rl.retryAfterSec);
    const userId = req.body?.userId;
    if (typeof userId !== 'string' || !userId.trim() || userId.length > 128) {
      return res.status(400).json({ error: 'userId (the Camofox browser session) is required' });
    }
    if (store.size() >= MAX_ACTIVE_SESSIONS) {
      await store.sweep();
      if (store.size() >= MAX_ACTIVE_SESSIONS) {
        return res.status(503).json({ error: 'Too many active phone pairings. Try again later.' });
      }
    }
    try {
      const { maxFiles, purpose } = req.body || {};
      const { session, pairingToken, desktopToken } = await store.createSession({
        userId: normalizeUserId(userId),
        maxFiles: Number.isInteger(maxFiles) ? maxFiles : undefined,
        purpose: typeof purpose === 'string' ? purpose : undefined,
      });
      log('info', 'phone-bridge: pairing created', { sessionId: session.id, userId: session.userId });
      res.status(201).json({
        ...sessionView(session),
        desktopToken,
        // Token rides in the fragment: never sent to servers, logs or Referer.
        pairUrl: `${baseUrl(req)}/phone-bridge/m#t=${pairingToken}`,
        publicUrlConfigured: Boolean(publicUrl),
      });
    } catch (err) {
      log('error', 'phone-bridge: create failed', { error: err.message });
      res.status(500).json({ error: safeError(err) });
    }
  });

  app.get('/phone-bridge/sessions/:id', ...desktop, (req, res) => {
    res.json(sessionView(req.bridgeSession));
  });

  app.delete('/phone-bridge/sessions/:id', ...desktop, async (req, res) => {
    await store.revoke(req.bridgeSession, 'desktop_revoke');
    res.json({ ok: true, status: 'revoked' });
  });

  app.delete('/phone-bridge/sessions/:id/files/:fileId', ...desktop, async (req, res) => {
    const removed = await store.removeFile(req.bridgeSession, req.params.fileId);
    if (!removed) return res.status(404).json({ error: 'File not found' });
    res.json({ ok: true });
  });

  app.get('/phone-bridge/sessions/:id/targets', ...desktop, requireActive, async (req, res) => {
    const session = req.bridgeSession;
    const browserSession = sessions.get(normalizeUserId(session.userId));
    const targets = [];
    for (const group of browserSession?.tabGroups?.values() || []) {
      for (const [tabId, tabState] of group) {
        const page = tabState.page;
        if (!page || page.isClosed?.()) continue;
        const [title, inputs] = await Promise.all([
          withTimeout(page.title().catch(() => ''), INPUT_SCAN_TIMEOUT_MS, ''),
          withTimeout(
            page.locator('input[type="file"]').evaluateAll(describeFileInputs).catch(() => []),
            INPUT_SCAN_TIMEOUT_MS,
            [],
          ),
        ]);
        targets.push({ tabId, url: page.url(), title, inputs });
      }
    }
    res.json({ targets });
  });

  app.post('/phone-bridge/sessions/:id/files/:fileId/attach', ...desktop, requireActive, async (req, res) => {
    const session = req.bridgeSession;
    const file = store.findFile(session, req.params.fileId);
    if (!file) return res.status(404).json({ error: 'File not found' });
    if (file.status === 'attaching') return res.status(409).json({ error: 'This file is already being attached' });

    const { tabId, inputIndex, pickerIndex } = req.body || {};
    if (typeof tabId !== 'string' || !tabId || tabId.length > 128) {
      return res.status(400).json({ error: 'tabId is required' });
    }
    const badIndex = (v) => v !== undefined && (!Number.isInteger(v) || v < 0 || v > 200);
    if (badIndex(inputIndex) || badIndex(pickerIndex)) {
      return res.status(400).json({ error: 'inputIndex / pickerIndex must be non-negative integers' });
    }
    // The pairing is bound to one browser session (userId): only its tabs qualify.
    const tabState = findOwnedTab(session, tabId);
    if (!tabState) {
      return res.status(404).json({ error: 'Tab not found in this browser session' });
    }

    await store.updateFile(session, file.id, { status: 'attaching', error: null });
    const filePath = store.filePath(session, file);
    let outcome;
    try {
      if (pickerIndex !== undefined) {
        // Upload questions behind an "Add file" button (Google Forms picker).
        const result = await attachThroughPicker(tabState.page, { triggerIndex: pickerIndex, files: filePath, log });
        outcome = { status: 200, data: { ok: true, via: result.via } };
      } else {
        const selector = inputIndex !== undefined ? `input[type="file"] >> nth=${inputIndex}` : undefined;
        outcome = await attachViaCore({ tabId, userId: session.userId, filePath, selector });
      }
    } catch (err) {
      outcome = {
        status: err.statusCode || 502,
        data: { error: err.name === 'TimeoutError' ? 'Attaching timed out' : err.message },
      };
    }

    // The session might have ended while the browser was working.
    if (session.endedAt) return res.status(410).json({ error: 'Session ended during attach' });

    if (outcome.status >= 200 && outcome.status < 300 && outcome.data?.ok) {
      const updated = await store.updateFile(session, file.id, {
        status: 'attached', attachedAt: Date.now(), attachedTabId: tabId, error: null,
      });
      log('info', 'phone-bridge: file attached', { sessionId: session.id, fileId: file.id, tabId, via: outcome.data.via });
      return res.json({ ok: true, via: outcome.data.via, file: fileView(updated) });
    }

    const reason = outcome.data?.error || `Browser upload failed (HTTP ${outcome.status})`;
    const updated = await store.updateFile(session, file.id, { status: 'failed', error: reason });
    log('warn', 'phone-bridge: attach failed', { sessionId: session.id, fileId: file.id, tabId, status: outcome.status });
    return res.status(outcome.status >= 400 && outcome.status < 500 ? 422 : 502).json({
      ok: false,
      error: reason,
      file: fileView(updated),
    });
  });

  // --- lifecycle ----------------------------------------------------------

  const sweepTimer = setInterval(() => {
    store.sweep().catch((err) => log('warn', 'phone-bridge: sweep failed', { error: err.message }));
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();

  // Files are only useful to the browser session they were sent to.
  events?.on?.('session:destroyed', async ({ userId }) => {
    const target = normalizeUserId(userId);
    for (const id of store.sessionIds()) {
      const session = store.get(id);
      if (session && session.userId === target && !session.endedAt) {
        await store.revoke(session, 'browser_session_destroyed').catch(() => {});
      }
    }
  });
  events?.on?.('server:shutdown', () => clearInterval(sweepTimer));

  log('info', 'phone-bridge plugin registered', { limits, publicUrlConfigured: Boolean(publicUrl) });
  return { store, isValidId };
}
