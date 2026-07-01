const { spawnSync } = require('node:child_process');
const path = require('node:path');

const playwrightCli = path.resolve(__dirname, '..', 'node_modules', 'playwright', 'cli.js');
const result = spawnSync(process.execPath, [playwrightCli, 'install', 'chromium'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: '0'
  }
});

if (result.error) {
  console.error(result.error.message);
}

process.exit(result.status ?? 1);
