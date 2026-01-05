// history.js

import fs from 'fs';
import { join } from 'path';

const DATA_DIR = process.env.TESTER_DATA_DIR || process.cwd();
const HISTORY_FILE = join(DATA_DIR, 'history.json');
const DEFAULT_HISTORY_LIMIT = 10;

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
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const raw = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      return normalizeStore(raw);
    }
  } catch (e) {
    console.error('Error loading history:', e);
  }
  return { entries: [], limits: {} };
}

function writeHistoryStore(store) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(store, null, 2));
}

export function loadHistory(userId = null) {
  const store = readHistoryStore();
  if (!userId) return store.entries;
  return store.entries.filter(entry => entry.userId === userId);
}

export function saveToHistory(entry, userId = null) {
  const store = readHistoryStore();
  const scopedUserId = userId || 'anonymous';
  const entryWithUser = { ...entry, userId: scopedUserId };
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
    return true;
  }
  return false;
}

export function clearHistory(userId = null) {
  const store = readHistoryStore();
  if (!userId) {
    store.entries = [];
    writeHistoryStore(store);
    return true;
  }
  store.entries = store.entries.filter(entry => entry.userId !== userId);
  writeHistoryStore(store);
  return true;
}
