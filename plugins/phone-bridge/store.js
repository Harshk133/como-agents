/**
 * Phone-bridge session store.
 *
 * Holds pairing sessions in memory and mirrors each one to
 * <rootDir>/<sessionId>/session.json so that, after a restart, expired
 * sessions and their files are still found and deleted. Tokens are never
 * stored -- only their SHA-256 hashes.
 *
 * Layout:
 *   <rootDir>/<sessionId>/session.json          manifest (no secrets)
 *   <rootDir>/<sessionId>/incoming/<id>.part    upload in progress
 *   <rootDir>/<sessionId>/files/<fileId>/<name> received file
 *
 * Every path component other than rootDir is server-generated; the only
 * client-influenced component is the sanitized display filename.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_LIMITS = Object.freeze({
  pairingTtlMs: 5 * 60 * 1000, // QR code usable for 5 minutes
  sessionTtlMs: 30 * 60 * 1000, // whole session (and its files) gone after 30 minutes
  maxFileBytes: 10 * 1024 * 1024,
  maxFiles: 10,
});

// Ended sessions keep a file-less tombstone this long so the desktop can see
// "revoked"/"expired" instead of a bare 404.
const TOMBSTONE_MS = 5 * 60 * 1000;

const ID_RE = /^[A-Za-z0-9_-]{8,32}$/;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function isValidId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

export function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function newId(bytes = 12) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function newPairingCode() {
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function hashMatches(token, expectedHash) {
  if (typeof token !== 'string' || !token || typeof expectedHash !== 'string' || !expectedHash) return false;
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Public, secret-free view of a file record. */
export function fileView(file) {
  return {
    id: file.id,
    name: file.name,
    type: file.type,
    size: file.size,
    status: file.status,
    createdAt: file.createdAt,
    attachedAt: file.attachedAt || null,
    attachedTabId: file.attachedTabId || null,
    error: file.error || null,
  };
}

export function createBridgeStore({ rootDir, log = () => {}, now = Date.now, limits = {} }) {
  const cfg = { ...DEFAULT_LIMITS };
  for (const [k, v] of Object.entries(limits)) {
    if (Number.isFinite(v) && v > 0) cfg[k] = v;
  }
  const root = path.resolve(rootDir);
  const sessions = new Map();

  const sessionDir = (id) => path.join(root, id);
  const manifestPath = (id) => path.join(sessionDir(id), 'session.json');
  const filesDir = (id) => path.join(sessionDir(id), 'files');
  const incomingDir = (id) => path.join(sessionDir(id), 'incoming');

  async function persist(session) {
    const target = manifestPath(session.id);
    const tmp = `${target}.tmp-${process.pid}-${newId(4)}`;
    await fs.mkdir(sessionDir(session.id), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(session), { mode: 0o600 });
    await fs.rename(tmp, target);
  }

  async function removeDir(dir) {
    await fs.rm(dir, { recursive: true, force: true }).catch((err) => {
      log('warn', 'phone-bridge: failed to remove directory', { error: err.message });
    });
  }

  /** waiting | paired | expired | revoked -- derived from timestamps. */
  function effectiveStatus(session) {
    if (session.status === 'revoked' || session.status === 'expired') return session.status;
    const t = now();
    if (t >= session.expiresAt) return 'expired';
    if (session.status === 'waiting' && t >= session.pairingExpiresAt) return 'expired';
    return session.status;
  }

  async function end(session, status, reason) {
    session.status = status;
    session.endedAt = now();
    session.endReason = reason;
    session.pairingTokenHash = null;
    session.phoneTokenHash = null;
    session.files = [];
    // Tombstone lives a little while for the desktop poller, then is purged.
    session.purgeAt = session.endedAt + TOMBSTONE_MS;
    await removeDir(filesDir(session.id));
    await removeDir(incomingDir(session.id));
    await persist(session);
    log('info', 'phone-bridge: session ended', { sessionId: session.id, status, reason });
  }

  async function purge(id) {
    sessions.delete(id);
    await removeDir(sessionDir(id));
  }

  const store = {
    limits: cfg,
    rootDir: root,
    filesDir,
    incomingDir,
    effectiveStatus,

    /** Load manifests left by a previous process and clean up what has lapsed. */
    async init() {
      await fs.mkdir(root, { recursive: true, mode: 0o700 });
      const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const dir = path.join(root, entry.name);
        if (!entry.isDirectory() || !isValidId(entry.name)) {
          await removeDir(dir);
          continue;
        }
        let session = null;
        try {
          session = JSON.parse(await fs.readFile(manifestPath(entry.name), 'utf8'));
        } catch { /* missing or corrupt manifest */ }
        if (!session || session.id !== entry.name) {
          await removeDir(dir);
          continue;
        }
        // Uploads interrupted by the restart are never completed.
        await removeDir(incomingDir(session.id));
        sessions.set(session.id, session);
      }
      await store.sweep();
      log('info', 'phone-bridge: store ready', { sessions: sessions.size });
    },

    /** Expire lapsed sessions and purge old tombstones. */
    async sweep() {
      const t = now();
      for (const session of [...sessions.values()]) {
        if (session.purgeAt && t >= session.purgeAt) {
          await purge(session.id);
          continue;
        }
        if (!session.endedAt && effectiveStatus(session) === 'expired') {
          await end(session, 'expired', 'ttl');
        }
      }
    },

    async createSession({ userId, maxFiles, purpose }) {
      const pairingToken = newToken();
      const desktopToken = newToken();
      const t = now();
      const session = {
        id: newId(),
        userId: String(userId),
        // Optional per-session cap (never above the global limit) and a short
        // description of what is being requested, shown on the phone.
        maxFiles: Number.isInteger(maxFiles) && maxFiles > 0 ? Math.min(maxFiles, cfg.maxFiles) : cfg.maxFiles,
        purpose: typeof purpose === 'string' ? purpose.replace(/\s+/g, ' ').trim().slice(0, 140) : '',
        code: newPairingCode(),
        status: 'waiting',
        createdAt: t,
        pairingExpiresAt: t + cfg.pairingTtlMs,
        expiresAt: t + cfg.sessionTtlMs,
        pairedAt: null,
        endedAt: null,
        pairingTokenHash: hashToken(pairingToken),
        desktopTokenHash: hashToken(desktopToken),
        phoneTokenHash: null,
        files: [],
      };
      sessions.set(session.id, session);
      await persist(session);
      return { session, pairingToken, desktopToken };
    },

    /** Session for a desktop credential, or null. Ended sessions still resolve (tombstone). */
    getForDesktop(id, desktopToken) {
      if (!isValidId(id)) return null;
      const session = sessions.get(id);
      if (!session || !hashMatches(desktopToken, session.desktopTokenHash)) return null;
      return session;
    },

    /** Waiting session for an unconsumed, unexpired pairing token, or null. */
    getForPairingToken(pairingToken) {
      if (typeof pairingToken !== 'string' || pairingToken.length < 20) return null;
      for (const session of sessions.values()) {
        if (hashMatches(pairingToken, session.pairingTokenHash)) {
          return effectiveStatus(session) === 'waiting' ? session : null;
        }
      }
      return null;
    },

    /** Active (paired, unexpired) session for a phone credential, or null. */
    getForPhoneToken(phoneToken) {
      if (typeof phoneToken !== 'string' || phoneToken.length < 20) return null;
      for (const session of sessions.values()) {
        if (hashMatches(phoneToken, session.phoneTokenHash)) {
          return effectiveStatus(session) === 'paired' ? session : null;
        }
      }
      return null;
    },

    /** Consume the pairing token and issue the phone's upload credential. */
    async pair(session) {
      if (effectiveStatus(session) !== 'waiting' || !session.pairingTokenHash) {
        throw Object.assign(new Error('Pairing is no longer available'), { statusCode: 410 });
      }
      const phoneToken = newToken();
      session.pairingTokenHash = null; // single use
      session.phoneTokenHash = hashToken(phoneToken);
      session.status = 'paired';
      session.pairedAt = now();
      await persist(session);
      return phoneToken;
    },

    async addFile(session, file) {
      session.files.push(file);
      await persist(session);
    },

    async updateFile(session, fileId, patch) {
      const file = session.files.find((f) => f.id === fileId);
      if (!file) return null;
      Object.assign(file, patch);
      await persist(session);
      return file;
    },

    findFile(session, fileId) {
      if (!isValidId(fileId)) return null;
      return session.files.find((f) => f.id === fileId) || null;
    },

    /** Absolute path of a stored file, resolved from server-generated parts only. */
    filePath(session, file) {
      return path.join(filesDir(session.id), file.id, file.storedName);
    },

    async removeFile(session, fileId) {
      const idx = session.files.findIndex((f) => f.id === fileId);
      if (idx === -1) return false;
      const [file] = session.files.splice(idx, 1);
      await removeDir(path.join(filesDir(session.id), file.id));
      await persist(session);
      return true;
    },

    async revoke(session, reason) {
      if (session.endedAt) return;
      await end(session, 'revoked', reason);
    },

    newFileId: () => newId(9),
    newUploadId: () => newId(9),
    size: () => sessions.size,
    sessionIds: () => [...sessions.keys()],
    get: (id) => sessions.get(id) || null,
  };

  return store;
}
