// session-lane-store.js
// Server-issued session IDs mapped to lane IDs for execution scoping.

import fs from 'fs';
import crypto from 'crypto';

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') {
    return cookies;
  }
  cookieHeader.split(';').forEach((chunk) => {
    const index = chunk.indexOf('=');
    if (index < 0) return;
    const key = chunk.slice(0, index).trim();
    const value = chunk.slice(index + 1).trim();
    if (!key) return;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  });
  return cookies;
}

function appendSetCookie(res, value) {
  if (typeof res.append === 'function') {
    res.append('Set-Cookie', value);
    return;
  }
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', value);
    return;
  }
  if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, value]);
    return;
  }
  res.setHeader('Set-Cookie', [String(existing), value]);
}

export class SessionLaneStore {
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.cookieName = options.cookieName || 'tester_sid';
    this.maxSessions = Number.isFinite(options.maxSessions) ? options.maxSessions : 10000;
    this.ttlMs = Number.isFinite(options.ttlMs)
      ? options.ttlMs
      : 1000 * 60 * 60 * 24 * 7;
    this.refreshIntervalMs = Number.isFinite(options.refreshIntervalMs)
      ? options.refreshIntervalMs
      : 1000 * 60;
    this.saveDebounceMs = Number.isFinite(options.saveDebounceMs)
      ? options.saveDebounceMs
      : 1000;
    this.secureCookie = options.secureCookie === true;
    this.sameSite = options.sameSite || 'Lax';
    this.sessions = new Map();
    this.lastPruneAt = 0;
    this.pruneIntervalMs = 1000 * 60;
    this.dirty = false;
    this.saveTimer = null;
  }

  load() {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      const list = Array.isArray(raw?.sessions) ? raw.sessions : [];
      const now = Date.now();
      list.forEach((entry) => {
        const sessionId = typeof entry?.sessionId === 'string' ? entry.sessionId : '';
        const laneId = typeof entry?.laneId === 'string' ? entry.laneId : '';
        const expiresAt = Number(entry?.expiresAt || 0);
        if (!sessionId || !laneId || !Number.isFinite(expiresAt) || expiresAt <= now) {
          return;
        }
        this.sessions.set(sessionId, {
          sessionId,
          laneId,
          createdAt: Number(entry?.createdAt || now),
          lastSeenAt: Number(entry?.lastSeenAt || now),
          expiresAt
        });
      });
      this.compactToLimit();
    } catch (err) {
      console.error('[SessionLaneStore] Failed to load session file', err);
      this.sessions.clear();
    }
  }

  markDirty() {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (!this.dirty) return;
      this.dirty = false;
      this.saveNow();
    }, this.saveDebounceMs);
    if (typeof this.saveTimer.unref === 'function') {
      this.saveTimer.unref();
    }
  }

  saveNow() {
    this.compactToLimit();
    const payload = {
      schemaVersion: 1,
      updatedAt: Date.now(),
      sessions: Array.from(this.sessions.values())
    };
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(payload, null, 2), 'utf8');
    } catch (err) {
      console.error('[SessionLaneStore] Failed to write session file', err);
    }
  }

  compactToLimit() {
    if (this.sessions.size <= this.maxSessions) return;
    const entries = Array.from(this.sessions.values()).sort(
      (a, b) => Number(b.lastSeenAt || 0) - Number(a.lastSeenAt || 0)
    );
    this.sessions.clear();
    entries.slice(0, this.maxSessions).forEach((entry) => {
      this.sessions.set(entry.sessionId, entry);
    });
  }

  evictOldestSessionIfNeeded() {
    if (this.sessions.size < this.maxSessions) return;
    let oldestSessionId = null;
    let oldestLastSeen = Number.POSITIVE_INFINITY;
    this.sessions.forEach((entry, sessionId) => {
      const lastSeenAt = Number(entry.lastSeenAt || 0);
      if (lastSeenAt >= oldestLastSeen) return;
      oldestLastSeen = lastSeenAt;
      oldestSessionId = sessionId;
    });
    if (oldestSessionId) {
      this.sessions.delete(oldestSessionId);
    }
  }

  pruneExpired(force = false) {
    const now = Date.now();
    if (!force && now - this.lastPruneAt < this.pruneIntervalMs) return;
    this.lastPruneAt = now;
    let changed = false;
    this.sessions.forEach((entry, sessionId) => {
      if (Number(entry.expiresAt || 0) > now) return;
      this.sessions.delete(sessionId);
      changed = true;
    });
    if (changed) {
      this.markDirty();
    }
  }

  parseSessionIdFromRequest(req) {
    const cookies = parseCookies(req?.headers?.cookie || '');
    const raw = cookies[this.cookieName];
    if (!raw) return null;
    const normalized = String(raw).trim();
    return normalized || null;
  }

  setSessionCookie(res, sessionId) {
    const maxAgeSeconds = Math.max(1, Math.floor(this.ttlMs / 1000));
    let cookie = `${this.cookieName}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=${this.sameSite}; Max-Age=${maxAgeSeconds}`;
    if (this.secureCookie) {
      cookie += '; Secure';
    }
    appendSetCookie(res, cookie);
  }

  createSession(now = Date.now()) {
    this.evictOldestSessionIfNeeded();
    const sessionId = crypto.randomUUID();
    const laneId = `lane_${crypto.randomUUID()}`;
    const entry = {
      sessionId,
      laneId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + this.ttlMs
    };
    this.sessions.set(sessionId, entry);
    this.markDirty();
    return entry;
  }

  getSessionById(sessionId) {
    if (!sessionId) return null;
    const entry = this.sessions.get(sessionId);
    if (!entry) return null;
    const now = Date.now();
    if (Number(entry.expiresAt || 0) <= now) {
      this.sessions.delete(sessionId);
      this.markDirty();
      return null;
    }
    return entry;
  }

  touchSession(entry, now = Date.now()) {
    if (!entry) return entry;
    if (now - Number(entry.lastSeenAt || 0) < this.refreshIntervalMs) return entry;
    entry.lastSeenAt = now;
    entry.expiresAt = now + this.ttlMs;
    this.markDirty();
    return entry;
  }

  ensureHttpSession(req, res) {
    this.pruneExpired();
    const now = Date.now();
    const incomingSessionId = this.parseSessionIdFromRequest(req);
    let session = this.getSessionById(incomingSessionId);
    let issuedNewSession = false;

    if (!session) {
      session = this.createSession(now);
      issuedNewSession = true;
    } else {
      this.touchSession(session, now);
    }

    if (issuedNewSession || !incomingSessionId || incomingSessionId !== session.sessionId) {
      this.setSessionCookie(res, session.sessionId);
    }

    req.testerSession = {
      sessionId: session.sessionId,
      laneId: session.laneId
    };
    return req.testerSession;
  }

  resolveLaneFromRequest(req) {
    const attached = req?.testerSession?.laneId;
    if (attached) return attached;
    const sessionId = this.parseSessionIdFromRequest(req);
    const session = this.getSessionById(sessionId);
    if (!session) return null;
    this.touchSession(session);
    return session.laneId;
  }
}
