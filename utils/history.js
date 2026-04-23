// history.js

import fs from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { log } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = process.env.TESTER_DATA_DIR || resolve(__dirname, '..');
const HISTORY_FILE = join(DATA_DIR, 'history.json');
const DEFAULT_HISTORY_LIMIT = 10;
let historyStoreCache = null;

function normalizeStore(raw) {
  if (!raw) {
    return { entries: [], limits: {} };
  }
  if (Array.isArray(raw)) {
    return { entries: raw, limits: {} };
  }
  if (typeof raw === 'object') {
    return {
      entries: Array.isArray(raw.entries) ? raw.entries : [],
      limits: raw.limits && typeof raw.limits === 'object' ? raw.limits : {}
    };
  }
  return { entries: [], limits: {} };
}

function readHistoryStore() {
  if (historyStoreCache) {
    return historyStoreCache;
  }
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const raw = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      historyStoreCache = normalizeStore(raw);
      return historyStoreCache;
    }
  } catch (e) {
    log('error', 'Error loading history', e);
  }
  historyStoreCache = { entries: [], limits: {} };
  return historyStoreCache;
}

function writeHistoryStore(store) {
  historyStoreCache = normalizeStore(store);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(historyStoreCache, null, 2));
}

export function loadHistory(userId = null) {
  const store = readHistoryStore();
  if (!userId) {
    log('debug', '[History] Loaded history entries', { userId: '(all)', count: store.entries.length });
    return store.entries;
  }
  const filtered = store.entries.filter(entry => entry.userId === userId);
  log('debug', '[History] Loaded history entries', {
    userId,
    count: filtered.length,
    totalEntries: store.entries.length
  });
  return filtered;
}

export function saveToHistory(entry, userId = null) {
  const store = readHistoryStore();
  const scopedUserId = userId || 'anonymous';
  const entryWithUser = { ...entry, userId: scopedUserId, read: false };
  store.entries.unshift(entryWithUser);

  const limit = getHistoryLimit(scopedUserId, store);
  let userCount = 0;
  store.entries = store.entries.filter((item) => {
    if (item.userId !== scopedUserId) {
      return true;
    }
    userCount += 1;
    return userCount <= limit;
  });

  writeHistoryStore(store);
  log('debug', '[History] Saved entry', {
    userId: scopedUserId,
    filename: entry.filename || 'unknown',
    retainedEntriesForUser: Math.min(userCount, limit),
    limit
  });
}

export function getHistoryLimit(userId = null, storeOverride = null) {
  const store = storeOverride || readHistoryStore();
  if (!userId) return DEFAULT_HISTORY_LIMIT;
  const value = store.limits?.[userId];
  if (typeof value === 'number' && value > 0) {
    return value;
  }
  return DEFAULT_HISTORY_LIMIT;
}

export function setHistoryLimit(userId, limit) {
  if (!userId) return false;
  if (limit && typeof limit === 'number' && limit > 0 && limit <= 100) {
    const store = readHistoryStore();
    store.limits = store.limits || {};
    store.limits[userId] = limit;
    writeHistoryStore(store);
    return true;
  }
  return false;
}

export function deleteFromHistory(filename, userId = null) {
  const store = readHistoryStore();
  const initialLength = store.entries.length;
  store.entries = store.entries.filter(entry => {
    if (entry.filename !== filename) return true;
    if (userId && entry.userId !== userId) return true;
    return false;
  });

  if (store.entries.length < initialLength) {
    writeHistoryStore(store);
    log('debug', '[History] Deleted entry', {
      filename,
      userId: userId || '(any)',
      totalEntries: store.entries.length
    });
    return true;
  }
  log('debug', '[History] Entry not found for delete', { filename, userId: userId || '(any)' });
  return false;
}

export function clearHistory(userId = null) {
  const store = readHistoryStore();
  if (!userId) {
    store.entries = [];
    writeHistoryStore(store);
    log('debug', '[History] Cleared all entries');
    return true;
  }
  const beforeCount = store.entries.length;
  store.entries = store.entries.filter(entry => entry.userId !== userId);
  const afterCount = store.entries.length;
  const deletedCount = beforeCount - afterCount;
  writeHistoryStore(store);
  log('debug', '[History] Cleared entries for user', { userId, deletedCount, remaining: afterCount });
  return true;
}

export function markAsRead(filename, userId = null) {
  const store = readHistoryStore();
  let found = false;
  store.entries = store.entries.map(entry => {
    if (entry.filename === filename && (!userId || entry.userId === userId)) {
      if (!entry.read) {
        found = true;
        return { ...entry, read: true };
      }
    }
    return entry;
  });

  if (found) {
    writeHistoryStore(store);
    log('debug', '[History] Marked entry as read', { filename, userId: userId || '(any)' });
    return true;
  }
  log('debug', '[History] Entry not found or already read', { filename, userId: userId || '(any)' });
  return false;
}
