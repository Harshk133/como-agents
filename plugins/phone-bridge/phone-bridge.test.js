import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { jest } from '@jest/globals';
import { createPluginEvents } from '../../lib/plugins.js';
import { requireAuth, accessKeyMiddleware } from '../../lib/auth.js';
import { register } from './index.js';
import { sniffType, sanitizeFilename, describeRejectedType } from './file-type.js';
import { createBridgeStore } from './store.js';

const API_KEY = 'desktop-api-key-for-tests';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const HEIC = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(16)]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeTab(url, inputs) {
  return {
    page: {
      url: () => url,
      title: async () => `Title of ${url}`,
      isClosed: () => false,
      locator: () => ({
        evaluateAll: async (fn) => fn(inputs.map((i) => ({
          labels: [{ innerText: i.label }],
          getAttribute: () => null,
          getBoundingClientRect: () => ({ width: 10, height: 10 }),
          name: i.name || '',
          id: '',
          accept: i.accept || '',
          multiple: false,
          disabled: false,
        }))),
      }),
    },
  };
}

/** Boot an express app with the plugin, a fake browser-session map and a stub core upload route. */
async function startBridge({ phoneBridge = {}, accessKey = '', uploadBehavior } = {}) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'camofox-phone-bridge-'));
  const uploadsDir = path.join(tmpDir, 'uploads');
  await fs.mkdir(uploadsDir);
  const config = {
    port: 0, bindHost: '', nodeEnv: 'test', apiKey: API_KEY, accessKey, uploadsDir, phoneBridge,
  };
  const sessions = new Map([
    ['alice', { tabGroups: new Map([['k', new Map([['tab-a', fakeTab('https://forms.test/a', [{ label: 'Photo' }, { label: 'Signature' }])]])]]) }],
    ['bob', { tabGroups: new Map([['k', new Map([['tab-b', fakeTab('https://forms.test/b', [])]])]]) }],
  ]);
  const events = createPluginEvents();
  const uploadCalls = [];
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  app.use(accessKeyMiddleware(config));
  // Stand-in for core POST /tabs/:tabId/upload.
  app.post('/tabs/:tabId/upload', (req, res) => {
    uploadCalls.push({ tabId: req.params.tabId, body: req.body, authorization: req.get('authorization') });
    const behavior = uploadBehavior?.(req) || { status: 200, body: { ok: true, via: 'direct_input' } };
    res.status(behavior.status).json(behavior.body);
  });
  const log = jest.fn();
  const ctx = {
    config,
    log,
    sessions,
    events,
    auth: () => requireAuth(config),
    normalizeUserId: (u) => String(u),
    safeError: (err) => err.message,
  };
  const { store } = await register(app, ctx, {});
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  config.port = server.address().port;
  const base = `http://127.0.0.1:${config.port}`;

  async function call(method, urlPath, { body, headers = {}, raw } = {}) {
    const res = await fetch(`${base}${urlPath}`, {
      method,
      headers: raw ? headers : { 'Content-Type': 'application/json', ...headers },
      body: raw ?? (body ? JSON.stringify(body) : undefined),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }

  const desk = { Authorization: `Bearer ${accessKey || API_KEY}` };

  async function createSession(userId = 'alice') {
    const r = await call('POST', '/phone-bridge/sessions', { body: { userId }, headers: desk });
    expect(r.status).toBe(201);
    const pairingToken = new URL(r.data.pairUrl).hash.replace('#t=', '');
    return { ...r.data, pairingToken };
  }

  async function pairPhone(session) {
    const r = await call('POST', '/phone-bridge/phone/pair', { body: { pairingToken: session.pairingToken, confirm: true } });
    expect(r.status).toBe(200);
    return r.data.phoneToken;
  }

  function upload(phoneToken, buf, name, extraHeaders = {}) {
    return call('POST', '/phone-bridge/phone/files', {
      raw: buf,
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Phone-Bridge-Token': phoneToken,
        'X-File-Name': encodeURIComponent(name),
        ...extraHeaders,
      },
    });
  }

  const deskFor = (s) => ({ ...desk, 'X-Phone-Bridge-Token': s.desktopToken });

  async function close() {
    await events.emitAsync('server:shutdown', {});
    await new Promise((r) => server.close(r));
    await fs.rm(tmpDir, { recursive: true, force: true });
  }

  return { call, createSession, pairPhone, upload, deskFor, desk, store, uploadsDir, uploadCalls, events, log, close };
}

describe('phone-bridge file-type', () => {
  test('sniffs allowed formats from content, not names', () => {
    expect(sniffType(PDF)).toBe('application/pdf');
    expect(sniffType(PNG)).toBe('image/png');
    expect(sniffType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
    expect(sniffType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]))).toBe('image/webp');
    expect(sniffType(Buffer.from('<script>alert(1)</script>'))).toBeNull();
    expect(describeRejectedType(HEIC)).toBe('HEIC photo');
  });

  test('sanitizes names: no directories, reserved characters or dot-names', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('..\\..\\win.ini')).toBe('win.ini');
    expect(sanitizeFilename('a<b>:c|d?.pdf')).toBe('abcd.pdf');
    expect(sanitizeFilename('..', 'pdf')).toBe('document.pdf');
    expect(sanitizeFilename('.hidden.pdf')).toBe('hidden.pdf');
    expect(sanitizeFilename(`${'x'.repeat(300)}.pdf`).length).toBeLessThanOrEqual(120);
  });
});

describe('phone-bridge plugin', () => {
  let bridge;
  afterEach(async () => { if (bridge) await bridge.close(); bridge = null; });

  test('desktop must authenticate to create a pairing session', async () => {
    bridge = await startBridge();
    const anon = await bridge.call('POST', '/phone-bridge/sessions', { body: { userId: 'alice' } });
    expect(anon.status).toBe(403);
    const bad = await bridge.call('POST', '/phone-bridge/sessions', { body: { userId: 'alice' }, headers: { Authorization: 'Bearer nope' } });
    expect(bad.status).toBe(403);

    const s = await bridge.createSession('alice');
    expect(s.status).toBe('waiting');
    expect(s.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(s.desktopToken.length).toBeGreaterThanOrEqual(40);
    expect(s.pairUrl).toMatch(/\/phone-bridge\/m#t=[A-Za-z0-9_-]{40,}$/);
    expect(s.pairingExpiresAt).toBeGreaterThan(Date.now());
  });

  test('session state needs that session\'s desktop token, not just its id', async () => {
    bridge = await startBridge();
    const a = await bridge.createSession('alice');
    const b = await bridge.createSession('bob');

    expect((await bridge.call('GET', `/phone-bridge/sessions/${a.sessionId}`, { headers: bridge.desk })).status).toBe(404);
    expect((await bridge.call('GET', `/phone-bridge/sessions/${a.sessionId}`, { headers: bridge.deskFor(b) })).status).toBe(404);
    const ok = await bridge.call('GET', `/phone-bridge/sessions/${a.sessionId}`, { headers: bridge.deskFor(a) });
    expect(ok.status).toBe(200);
    expect(ok.data.desktopToken).toBeUndefined();
  });

  test('phone previews, confirms pairing, and the pairing token cannot be replayed', async () => {
    bridge = await startBridge();
    const s = await bridge.createSession();

    const preview = await bridge.call('POST', '/phone-bridge/phone/preview', { body: { pairingToken: s.pairingToken } });
    expect(preview.status).toBe(200);
    expect(preview.data.code).toBe(s.code);

    const unconfirmed = await bridge.call('POST', '/phone-bridge/phone/pair', { body: { pairingToken: s.pairingToken } });
    expect(unconfirmed.status).toBe(400);

    const phoneToken = await bridge.pairPhone(s);
    expect(phoneToken).not.toBe(s.pairingToken);

    const replay = await bridge.call('POST', '/phone-bridge/phone/pair', { body: { pairingToken: s.pairingToken, confirm: true } });
    expect(replay.status).toBe(404);
    expect((await bridge.call('POST', '/phone-bridge/phone/preview', { body: { pairingToken: s.pairingToken } })).status).toBe(404);

    const status = await bridge.call('GET', '/phone-bridge/phone/status', { headers: { 'X-Phone-Bridge-Token': phoneToken } });
    expect(status.status).toBe(200);
    expect(status.data.status).toBe('paired');

    const desk = await bridge.call('GET', `/phone-bridge/sessions/${s.sessionId}`, { headers: bridge.deskFor(s) });
    expect(desk.data.status).toBe('paired');
  });

  test('expired pairing tokens are rejected', async () => {
    bridge = await startBridge({ phoneBridge: { pairingTtlMs: 150 } });
    const s = await bridge.createSession();
    await sleep(250);
    const r = await bridge.call('POST', '/phone-bridge/phone/pair', { body: { pairingToken: s.pairingToken, confirm: true } });
    expect(r.status).toBe(404);
    const desk = await bridge.call('GET', `/phone-bridge/sessions/${s.sessionId}`, { headers: bridge.deskFor(s) });
    expect(desk.data.status).toBe('expired');
  });

  test('revoked sessions reject pairing and phone tokens and delete files', async () => {
    bridge = await startBridge();
    const unpaired = await bridge.createSession();
    await bridge.call('DELETE', `/phone-bridge/sessions/${unpaired.sessionId}`, { headers: bridge.deskFor(unpaired) });
    expect((await bridge.call('POST', '/phone-bridge/phone/pair', { body: { pairingToken: unpaired.pairingToken, confirm: true } })).status).toBe(404);

    const s = await bridge.createSession();
    const phoneToken = await bridge.pairPhone(s);
    const up = await bridge.upload(phoneToken, PDF, 'marksheet.pdf');
    expect(up.status).toBe(201);
    const filesDir = path.join(bridge.uploadsDir, 'phone-bridge', s.sessionId, 'files');
    expect((await fs.readdir(filesDir)).length).toBe(1);

    const revoke = await bridge.call('DELETE', `/phone-bridge/sessions/${s.sessionId}`, { headers: bridge.deskFor(s) });
    expect(revoke.status).toBe(200);
    expect((await bridge.upload(phoneToken, PDF, 'again.pdf')).status).toBe(401);
    await expect(fs.access(filesDir)).rejects.toThrow();
    const desk = await bridge.call('GET', `/phone-bridge/sessions/${s.sessionId}`, { headers: bridge.deskFor(s) });
    expect(desk.data).toMatchObject({ status: 'revoked', files: [] });
  });

  test('uploads require a phone credential (not the desktop token)', async () => {
    bridge = await startBridge();
    const s = await bridge.createSession();
    expect((await bridge.upload('', PDF, 'a.pdf')).status).toBe(401);
    expect((await bridge.upload(s.desktopToken, PDF, 'a.pdf')).status).toBe(401);
    expect((await bridge.upload(s.pairingToken, PDF, 'a.pdf')).status).toBe(401);
  });

  test('oversized files and per-session file limits are enforced', async () => {
    bridge = await startBridge({ phoneBridge: { maxFileBytes: 1024, maxFiles: 2 } });
    const s = await bridge.createSession();
    const phoneToken = await bridge.pairPhone(s);

    const big = Buffer.concat([PDF, Buffer.alloc(2048)]);
    const r = await bridge.upload(phoneToken, big, 'big.pdf');
    expect(r.status).toBe(413);

    expect((await bridge.upload(phoneToken, PDF, '1.pdf')).status).toBe(201);
    expect((await bridge.upload(phoneToken, PDF, '2.pdf')).status).toBe(201);
    const third = await bridge.upload(phoneToken, PDF, '3.pdf');
    expect(third.status).toBe(409);

    // Nothing partial is left behind.
    const incoming = path.join(bridge.uploadsDir, 'phone-bridge', s.sessionId, 'incoming');
    expect(await fs.readdir(incoming).catch(() => [])).toEqual([]);
  });

  test('invalid types and content/extension mismatches are rejected', async () => {
    bridge = await startBridge();
    const s = await bridge.createSession();
    const phoneToken = await bridge.pairPhone(s);

    const html = await bridge.upload(phoneToken, Buffer.from('<html><script>x</script></html>'), 'cv.pdf');
    expect(html.status).toBe(415);
    const mismatch = await bridge.upload(phoneToken, PNG, 'scan.pdf');
    expect(mismatch.status).toBe(415);
    expect(mismatch.data.error).toMatch(/does not match/);
    const heic = await bridge.upload(phoneToken, HEIC, 'IMG_0001.jpg');
    expect(heic.status).toBe(415);
    expect(heic.data.error).toMatch(/HEIC/);
    // A non-octet-stream body is refused: the global JSON parser rejects it
    // (400) before the plugin's own content-type check (415) would.
    const json = await bridge.upload(phoneToken, PDF, 'a.pdf', { 'Content-Type': 'application/json' });
    expect([400, 415]).toContain(json.status);
    const text = await bridge.upload(phoneToken, PDF, 'a.pdf', { 'Content-Type': 'text/plain' });
    expect(text.status).toBe(415);

    const desk = await bridge.call('GET', `/phone-bridge/sessions/${s.sessionId}`, { headers: bridge.deskFor(s) });
    expect(desk.data.files).toEqual([]);
  });

  test('received files are visible only to their own desktop session, with safe names', async () => {
    bridge = await startBridge();
    const a = await bridge.createSession('alice');
    const b = await bridge.createSession('bob');
    const phoneA = await bridge.pairPhone(a);

    const up = await bridge.upload(phoneA, PDF, '../../../etc/Marksheet 2024.pdf');
    expect(up.status).toBe(201);
    expect(up.data.file).toMatchObject({ name: 'Marksheet 2024.pdf', type: 'application/pdf', size: PDF.length, status: 'received' });
    expect(JSON.stringify(up.data)).not.toContain(bridge.uploadsDir);

    const deskA = await bridge.call('GET', `/phone-bridge/sessions/${a.sessionId}`, { headers: bridge.deskFor(a) });
    expect(deskA.data.files.map((f) => f.id)).toEqual([up.data.file.id]);
    const deskB = await bridge.call('GET', `/phone-bridge/sessions/${b.sessionId}`, { headers: bridge.deskFor(b) });
    expect(deskB.data.files).toEqual([]);

    // B's credential cannot reach A's file through any route.
    const fileId = up.data.file.id;
    expect((await bridge.call('DELETE', `/phone-bridge/sessions/${a.sessionId}/files/${fileId}`, { headers: bridge.deskFor(b) })).status).toBe(404);
    expect((await bridge.call('DELETE', `/phone-bridge/sessions/${b.sessionId}/files/${fileId}`, { headers: bridge.deskFor(b) })).status).toBe(404);
    expect((await bridge.call('POST', `/phone-bridge/sessions/${b.sessionId}/files/${fileId}/attach`, {
      body: { tabId: 'tab-b' }, headers: bridge.deskFor(b),
    })).status).toBe(404);

    const stored = path.join(bridge.uploadsDir, 'phone-bridge', a.sessionId, 'files', fileId, 'Marksheet 2024.pdf');
    expect(await fs.readFile(stored)).toEqual(PDF);

    const del = await bridge.call('DELETE', `/phone-bridge/sessions/${a.sessionId}/files/${fileId}`, { headers: bridge.deskFor(a) });
    expect(del.status).toBe(200);
    await expect(fs.access(stored)).rejects.toThrow();
  });

  test('targets list only tabs of the paired browser session, with their file inputs', async () => {
    bridge = await startBridge();
    const a = await bridge.createSession('alice');
    const r = await bridge.call('GET', `/phone-bridge/sessions/${a.sessionId}/targets`, { headers: bridge.deskFor(a) });
    expect(r.status).toBe(200);
    expect(r.data.targets).toHaveLength(1);
    expect(r.data.targets[0]).toMatchObject({ tabId: 'tab-a', url: 'https://forms.test/a' });
    expect(r.data.targets[0].inputs.map((i) => i.label)).toEqual(['Photo', 'Signature']);
  });

  test('attach uses the paired browser session and the chosen input; other sessions\' tabs are refused', async () => {
    bridge = await startBridge();
    const a = await bridge.createSession('alice');
    const phoneA = await bridge.pairPhone(a);
    const { data } = await bridge.upload(phoneA, PDF, 'signature.pdf');
    const fileId = data.file.id;
    const attachUrl = `/phone-bridge/sessions/${a.sessionId}/files/${fileId}/attach`;

    const foreign = await bridge.call('POST', attachUrl, { body: { tabId: 'tab-b' }, headers: bridge.deskFor(a) });
    expect(foreign.status).toBe(404);
    expect(bridge.uploadCalls).toHaveLength(0);

    const ok = await bridge.call('POST', attachUrl, { body: { tabId: 'tab-a', inputIndex: 1 }, headers: bridge.deskFor(a) });
    expect(ok.status).toBe(200);
    expect(ok.data).toMatchObject({ ok: true, via: 'direct_input', file: { status: 'attached', attachedTabId: 'tab-a' } });
    expect(bridge.uploadCalls).toHaveLength(1);
    const [callArgs] = bridge.uploadCalls;
    expect(callArgs.tabId).toBe('tab-a');
    expect(callArgs.body.userId).toBe('alice');
    expect(callArgs.body.selector).toBe('input[type="file"] >> nth=1');
    expect(callArgs.body.path).toBe(path.join(bridge.uploadsDir, 'phone-bridge', a.sessionId, 'files', fileId, 'signature.pdf'));
    expect(callArgs.authorization).toBe(`Bearer ${API_KEY}`);
  });

  test('a failed browser attachment is reported, not shown as success', async () => {
    bridge = await startBridge({
      uploadBehavior: () => ({ status: 422, body: { error: 'Upload trigger did not open a file chooser or mount a file input.' } }),
    });
    const a = await bridge.createSession('alice');
    const phoneA = await bridge.pairPhone(a);
    const { data } = await bridge.upload(phoneA, PDF, 'photo.pdf');
    const r = await bridge.call('POST', `/phone-bridge/sessions/${a.sessionId}/files/${data.file.id}/attach`, {
      body: { tabId: 'tab-a' }, headers: bridge.deskFor(a),
    });
    expect(r.status).toBe(422);
    expect(r.data).toMatchObject({ ok: false, file: { status: 'failed' } });
    expect(r.data.error).toMatch(/did not open a file chooser/);
  });

  test('phone disconnect revokes the session for the desktop too', async () => {
    bridge = await startBridge();
    const s = await bridge.createSession();
    const phoneToken = await bridge.pairPhone(s);
    await bridge.upload(phoneToken, PDF, 'a.pdf');
    const r = await bridge.call('POST', '/phone-bridge/phone/disconnect', { headers: { 'X-Phone-Bridge-Token': phoneToken } });
    expect(r.status).toBe(200);
    const desk = await bridge.call('GET', `/phone-bridge/sessions/${s.sessionId}`, { headers: bridge.deskFor(s) });
    expect(desk.data).toMatchObject({ status: 'revoked', endReason: 'phone_disconnect', files: [] });
  });

  test('destroying the browser session revokes its phone pairings', async () => {
    bridge = await startBridge();
    const a = await bridge.createSession('alice');
    const b = await bridge.createSession('bob');
    await bridge.events.emitAsync('session:destroyed', { userId: 'alice', reason: 'test' });
    await sleep(20);
    expect((await bridge.call('GET', `/phone-bridge/sessions/${a.sessionId}`, { headers: bridge.deskFor(a) })).data.status).toBe('revoked');
    expect((await bridge.call('GET', `/phone-bridge/sessions/${b.sessionId}`, { headers: bridge.deskFor(b) })).data.status).toBe('waiting');
  });

  test('session expiry removes files', async () => {
    bridge = await startBridge({ phoneBridge: { sessionTtlMs: 400 } });
    const s = await bridge.createSession();
    const phoneToken = await bridge.pairPhone(s);
    expect((await bridge.upload(phoneToken, PDF, 'a.pdf')).status).toBe(201);
    await sleep(450);
    expect((await bridge.upload(phoneToken, PDF, 'b.pdf')).status).toBe(401);
    await bridge.store.sweep();
    await expect(fs.access(path.join(bridge.uploadsDir, 'phone-bridge', s.sessionId, 'files'))).rejects.toThrow();
  });

  test('phone page is served with a strict CSP and no caching', async () => {
    bridge = await startBridge();
    const r = await bridge.call('GET', '/phone-bridge/m');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-security-policy')).toMatch(/default-src 'none'/);
    expect(r.headers.get('content-security-policy')).toMatch(/script-src 'nonce-/);
    expect(r.headers.get('cache-control')).toMatch(/no-store/);
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
    expect(r.data).toContain('Send files to your computer');
  });

  test('with CAMOFOX_ACCESS_KEY set, phone routes stay reachable but desktop routes are gated', async () => {
    bridge = await startBridge({ accessKey: 'global-access-key' });
    expect((await bridge.call('POST', '/phone-bridge/sessions', { body: { userId: 'alice' } })).status).toBe(401);
    const s = await bridge.createSession('alice'); // sends the access key
    expect((await bridge.call('GET', '/phone-bridge/m')).status).toBe(200);
    const phoneToken = await bridge.pairPhone(s); // no access key
    expect((await bridge.upload(phoneToken, PDF, 'a.pdf')).status).toBe(201);
    expect((await bridge.call('GET', `/phone-bridge/sessions/${s.sessionId}`, {
      headers: { 'X-Phone-Bridge-Token': s.desktopToken },
    })).status).toBe(401);
  });

  test('repeated bad credentials are rate limited', async () => {
    bridge = await startBridge();
    let last;
    for (let i = 0; i < 25; i++) {
      last = await bridge.call('POST', '/phone-bridge/phone/preview', { body: { pairingToken: `guess-${i}-xxxxxxxxxxxxxxxxxxxxxxxx` } });
    }
    expect(last.status).toBe(429);
  });

  test('a pairing can request one specific file: limit and purpose reach the phone', async () => {
    bridge = await startBridge({ phoneBridge: { maxFiles: 5 } });
    const r = await bridge.call('POST', '/phone-bridge/sessions', {
      body: { userId: 'alice', maxFiles: 1, purpose: '  Passport   photo  ' }, headers: bridge.desk,
    });
    expect(r.status).toBe(201);
    expect(r.data).toMatchObject({ purpose: 'Passport photo', limits: { maxFiles: 1, remainingFiles: 1 } });
    const pairingToken = new URL(r.data.pairUrl).hash.replace('#t=', '');
    const preview = await bridge.call('POST', '/phone-bridge/phone/preview', { body: { pairingToken } });
    expect(preview.data.purpose).toBe('Passport photo');
    const phoneToken = await bridge.pairPhone({ pairingToken });
    expect((await bridge.upload(phoneToken, PDF, 'photo.pdf')).status).toBe(201);
    const second = await bridge.upload(phoneToken, PDF, 'extra.pdf');
    expect(second.status).toBe(409);

    // A requested limit can never exceed the server's.
    const big = await bridge.call('POST', '/phone-bridge/sessions', { body: { userId: 'alice', maxFiles: 50 }, headers: bridge.desk });
    expect(big.data.limits.maxFiles).toBe(5);
  });

  test('picker attach failures are reported on the file', async () => {
    bridge = await startBridge();
    const a = await bridge.createSession('alice');
    const phoneA = await bridge.pairPhone(a);
    const { data } = await bridge.upload(phoneA, PDF, 'photo.pdf');
    const url = `/phone-bridge/sessions/${a.sessionId}/files/${data.file.id}/attach`;
    expect((await bridge.call('POST', url, { body: { tabId: 'tab-a', pickerIndex: -1 }, headers: bridge.deskFor(a) })).status).toBe(400);
    // The fake page has no "Add file" button, so the picker flow must fail loudly.
    const r = await bridge.call('POST', url, { body: { tabId: 'tab-a', pickerIndex: 0 }, headers: bridge.deskFor(a) });
    expect(r.data).toMatchObject({ ok: false, file: { status: 'failed' } });
    expect(bridge.uploadCalls).toHaveLength(0);
  });

  test('tokens are never logged', async () => {
    bridge = await startBridge();
    const s = await bridge.createSession();
    const phoneToken = await bridge.pairPhone(s);
    await bridge.upload(phoneToken, PDF, 'a.pdf');
    const logged = JSON.stringify(bridge.log.mock.calls);
    for (const secret of [s.desktopToken, s.pairingToken, phoneToken]) expect(logged).not.toContain(secret);
  });
});

describe('phone-bridge store restart cleanup', () => {
  test('expired sessions, orphan dirs and partial uploads from a previous process are removed', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'camofox-phone-store-'));
    try {
      let t = 1_000_000;
      const first = createBridgeStore({ rootDir: root, now: () => t, limits: { sessionTtlMs: 1000 } });
      await first.init();
      const { session: expired } = await first.createSession({ userId: 'u1' });
      const fileDir = path.join(first.filesDir(expired.id), 'f1');
      await fs.mkdir(fileDir, { recursive: true });
      await fs.writeFile(path.join(fileDir, 'doc.pdf'), PDF);
      await fs.mkdir(first.incomingDir(expired.id), { recursive: true });
      await fs.writeFile(path.join(first.incomingDir(expired.id), 'x.part'), 'partial');
      await fs.mkdir(path.join(root, 'not-a-session-dir!'));

      t += 5000; // past the session TTL; "restart" with a new store
      const second = createBridgeStore({ rootDir: root, now: () => t, limits: { sessionTtlMs: 1000 } });
      await second.init();

      await expect(fs.access(first.filesDir(expired.id))).rejects.toThrow();
      await expect(fs.access(first.incomingDir(expired.id))).rejects.toThrow();
      await expect(fs.access(path.join(root, 'not-a-session-dir!'))).rejects.toThrow();
      const manifest = JSON.parse(await fs.readFile(path.join(root, expired.id, 'session.json'), 'utf8'));
      expect(manifest.status).toBe('expired');
      expect(JSON.stringify(manifest)).not.toMatch(/pairingToken"|phoneToken"|desktopToken"/);

      t += 10 * 60 * 1000; // tombstone purged
      await second.sweep();
      await expect(fs.access(path.join(root, expired.id))).rejects.toThrow();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
