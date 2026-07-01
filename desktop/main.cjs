const { app, BrowserWindow, dialog, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP_NAME = 'Melaleuca Content QA Tester';
const READY_PATTERN = /Server running at:\s*(http:\/\/(?:localhost|127\.0\.0\.1):\d+\/?)/i;
const STARTUP_TIMEOUT_MS = 45000;

let mainWindow = null;
let serverProcess = null;
let serverUrl = null;
let isQuitting = false;
const recentServerLogs = [];

app.setName(APP_NAME);

function rememberServerLog(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    recentServerLogs.push(line);
  }

  while (recentServerLogs.length > 80) {
    recentServerLogs.shift();
  }
}

function getServerRoot() {
  const appRoot = path.resolve(__dirname, '..');
  return appRoot.includes('app.asar')
    ? appRoot.replace('app.asar', 'app.asar.unpacked')
    : appRoot;
}

function getDesktopDataDir() {
  if (process.env.TESTER_DESKTOP_DATA_DIR) {
    return path.resolve(process.env.TESTER_DESKTOP_DATA_DIR);
  }

  if (process.env.TESTER_DATA_DIR) {
    return path.resolve(process.env.TESTER_DATA_DIR);
  }

  const localAppData = process.env.LOCALAPPDATA || app.getPath('userData');
  return path.join(localAppData, APP_NAME);
}

function ensureDirectory(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function resolvePlaywrightBrowsersPath() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
    return process.env.PLAYWRIGHT_BROWSERS_PATH;
  }

  const hermeticBrowsersDir = path.join(
    getServerRoot(),
    'node_modules',
    'playwright-core',
    '.local-browsers'
  );

  return fs.existsSync(hermeticBrowsersDir) ? '0' : null;
}

function buildServerEnv(dataDir) {
  const cpuCount = Array.isArray(os.cpus()) ? os.cpus().length : 4;
  const defaultConcurrency = String(Math.max(2, Math.min(cpuCount, 12)));
  const playwrightBrowsersPath = resolvePlaywrightBrowsersPath();

  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    TESTER_DESKTOP: '1',
    TESTER_NO_AUTO_OPEN: '1',
    TESTER_HOST: process.env.TESTER_HOST || '127.0.0.1',
    TESTER_PORT: process.env.TESTER_PORT || '0',
    TESTER_DATA_DIR: dataDir,
    CATEGORIES_PATH: process.env.CATEGORIES_PATH || path.join(dataDir, 'categories.json'),
    TESTER_TOOL_CONCURRENCY: process.env.TESTER_TOOL_CONCURRENCY || defaultConcurrency
  };

  if (playwrightBrowsersPath) {
    env.PLAYWRIGHT_BROWSERS_PATH = playwrightBrowsersPath;
  }

  return env;
}

function isLocalAppUrl(value) {
  if (!serverUrl || !value) return false;

  try {
    const expected = new URL(serverUrl);
    const candidate = new URL(value);
    return candidate.protocol === 'http:'
      && candidate.hostname === expected.hostname
      && candidate.port === expected.port;
  } catch {
    return false;
  }
}

function openAllowedExternalUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') {
      return false;
    }
    shell.openExternal(parsed.href);
    return true;
  } catch {
    return false;
  }
}

function createLoadingHtml() {
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${APP_NAME}</title>`,
    '<style>',
    'body{margin:0;height:100vh;display:grid;place-items:center;background:#111827;color:#f9fafb;font-family:Segoe UI,Arial,sans-serif;}',
    '.shell{display:grid;gap:12px;text-align:center;}',
    '.spinner{width:42px;height:42px;border:4px solid rgba(255,255,255,.2);border-top-color:#38bdf8;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto;}',
    '.title{font-size:18px;font-weight:650;}',
    '.meta{font-size:13px;color:#cbd5e1;}',
    '@keyframes spin{to{transform:rotate(360deg)}}',
    '</style>',
    '</head>',
    '<body>',
    '<div class="shell"><div class="spinner"></div><div class="title">Starting Content QA Tester</div><div class="meta">Preparing the local test runner...</div></div>',
    '</body>',
    '</html>'
  ].join('');
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: APP_NAME,
    backgroundColor: '#111827',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(createLoadingHtml())}`);
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isLocalAppUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          title: APP_NAME,
          backgroundColor: '#111827',
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
          }
        }
      };
    }

    openAllowedExternalUrl(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isLocalAppUrl(url)) return;
    event.preventDefault();
    openAllowedExternalUrl(url);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function startServer() {
  const serverRoot = getServerRoot();
  const serverEntry = path.join(serverRoot, 'server.js');
  const dataDir = ensureDirectory(getDesktopDataDir());

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Local server did not start within ${STARTUP_TIMEOUT_MS / 1000} seconds.`));
    }, STARTUP_TIMEOUT_MS);

    serverProcess = spawn(process.execPath, [serverEntry], {
      cwd: serverRoot,
      env: buildServerEnv(dataDir),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    serverProcess.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      rememberServerLog(text);
      const match = text.match(READY_PATTERN);
      if (!settled && match) {
        settled = true;
        clearTimeout(timeout);
        serverUrl = match[1];
        resolve(serverUrl);
      }
    });

    serverProcess.stderr.on('data', (chunk) => {
      rememberServerLog(chunk.toString());
    });

    serverProcess.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });

    serverProcess.on('exit', (code, signal) => {
      serverProcess = null;
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`Local server exited before startup. Code: ${code ?? 'none'}, signal: ${signal ?? 'none'}.`));
        return;
      }

      if (!isQuitting && mainWindow) {
        dialog.showErrorBox(APP_NAME, 'The local test runner stopped unexpectedly. Please restart the app.');
        app.quit();
      }
    });
  });
}

function stopServer() {
  if (!serverProcess || serverProcess.killed) return;

  const pid = serverProcess.pid;
  if (process.platform === 'win32' && pid) {
    spawn('taskkill.exe', ['/pid', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore'
    });
    return;
  }

  serverProcess.kill('SIGTERM');
}

async function boot() {
  createMainWindow();

  try {
    const url = await startServer();
    if (mainWindow) {
      await mainWindow.loadURL(url);
    }
  } catch (error) {
    const logTail = recentServerLogs.slice(-20).join('\n');
    const detail = logTail ? `${error.message}\n\nRecent server output:\n${logTail}` : error.message;
    dialog.showErrorBox(APP_NAME, detail);
    app.quit();
  }
}

app.whenReady().then(boot);

app.on('before-quit', () => {
  isQuitting = true;
  stopServer();
});

app.on('window-all-closed', () => {
  app.quit();
});
