// history.js

import fs from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = process.env.TESTER_DATA_DIR || resolve(__dirname, '..');
const HISTORY_FILE = join(DATA_DIR, 'history.json');
let historyLimit = 10;

export function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading history:', e);
  }
  return [];
}

export function saveToHistory(entry) {
  let history = loadHistory();
  history.unshift(entry);

  if (history.length > historyLimit) {
    history = history.slice(0, historyLimit);
  }

  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

export function getHistoryLimit() {
  return historyLimit;
}

export function setHistoryLimit(limit) {
  if (limit && typeof limit === 'number' && limit > 0 && limit <= 100) {
    historyLimit = limit;
    return true;
  }
  return false;
}

export function deleteFromHistory(filename) {
  let history = loadHistory();
  const initialLength = history.length;
  history = history.filter(entry => entry.filename !== filename);

  if (history.length < initialLength) {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    return true;
  }
  return false;
}

export function clearHistory() {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify([], null, 2));
  return true;
}
