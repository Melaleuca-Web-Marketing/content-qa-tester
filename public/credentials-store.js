// credentials-store.js - Shared credential storage helpers

(function initCredentialStore() {
  const STORAGE_KEY = 'testerCredentialsV1';

  function normalizeStore(raw) {
    const base = { entries: {} };
    if (!raw || typeof raw !== 'object') return base;
    if (raw.entries && typeof raw.entries === 'object') {
      base.entries = raw.entries;
    }
    // Note: envSignIn storage removed for security - users must manually sign in to Stage/UAT
    return base;
  }

  function readStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return normalizeStore(null);
      const parsed = JSON.parse(raw);
      return normalizeStore(parsed);
    } catch (e) {
      return normalizeStore(null);
    }
  }

  function writeStore(store) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }

  function makeKey(environment, culture) {
    return `${environment}|${culture}`;
  }

  function getEntry(environment, culture) {
    if (!environment || !culture) return null;
    const store = readStore();
    return store.entries[makeKey(environment, culture)] || null;
  }

  function setEntry(environment, culture, entry) {
    if (!environment || !culture) return;
    const store = readStore();
    store.entries[makeKey(environment, culture)] = {
      username: entry.username || null,
      password: entry.password || null
    };
    writeStore(store);
  }

  function removeEntry(environment, culture) {
    if (!environment || !culture) return;
    const store = readStore();
    delete store.entries[makeKey(environment, culture)];
    writeStore(store);
  }

  function listEntries() {
    const store = readStore();
    return Object.entries(store.entries).map(([key, entry]) => {
      const [environment, culture] = key.split('|');
      return {
        key,
        environment,
        culture,
        ...entry
      };
    });
  }

  // Environment sign-in functions removed for security
  // Users must manually sign in to Stage/UAT when prompted by the tool

  window.CredentialStore = {
    getEntry,
    setEntry,
    removeEntry,
    listEntries
  };
})();
