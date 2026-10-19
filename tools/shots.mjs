/**
 * Visual check: drives the dev server in headless Chromium and writes
 * screenshots of the desktop, start menu, command bar and app windows.
 *
 *   npm run dev            # in another terminal
 *   node tools/shots.mjs [--url=http://127.0.0.1:4173/newtab/index.html]
 *
 * Output goes to .shots/*.jpg (git-ignored).
 */
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const URL = (args.find((arg) => arg.startsWith('--url=')) || '').slice(6)
  || 'http://127.0.0.1:4173/newtab/index.html';
const PORT = 9444;
const OUT = join(ROOT, '.shots');

const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean).find((path) => existsSync(path));

if (!CHROME) {
  console.error('No Chromium build found. Set CHROME_PATH.');
  process.exit(1);
}

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.id = 0;
    this.pending = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id === undefined) return;
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(`${message.error.message} (${entry.method})`));
      else entry.resolve(message.result);
    });
  }

  static connect(url) {
    return new Promise((resolvePromise, reject) => {
      const socket = new WebSocket(url);
      socket.addEventListener('open', () => resolvePromise(new Cdp(socket)), { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
  }

  send(method, params = {}, sessionId = null) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.socket.send(JSON.stringify(payload));
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject, method });
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 30_000);
    });
  }
}

const profile = await mkdtemp(join(tmpdir(), 'radon-shots-'));
const browser = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--headless=new',
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  '--window-size=1440,900',
  'about:blank',
], { stdio: 'ignore' });

async function debuggerUrl() {
  for (let i = 0; i < 80; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (response.ok) return (await response.json()).webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('Chromium never exposed its debug port');
}

let cdp;
let session;
try {
  cdp = await Cdp.connect(await debuggerUrl());
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: session } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));

  await cdp.send('Page.enable', {}, session);
  await cdp.send('Runtime.enable', {}, session);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  }, session);
  await cdp.send('Page.navigate', { url: URL }, session);

  const evaluate = async (expression) => {
    const result = await cdp.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true,
    }, session);
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || 'evaluate failed');
    }
    return result.result.value;
  };

  for (let i = 0; i < 60; i++) {
    if (await evaluate('!!window.RadonOS')) break;
    await sleep(250);
  }
  await sleep(1200);

  await mkdir(OUT, { recursive: true });
  const shot = async (name) => {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'jpeg', quality: 82, captureBeyondViewport: false,
    }, session);
    await writeFile(join(OUT, `${name}.jpg`), Buffer.from(data, 'base64'));
    console.log(`✓ .shots/${name}.jpg`);
  };

  await shot('ui-desktop');

  await evaluate("document.querySelector('#start-button').click()");
  await sleep(600);
  await shot('ui-start');

  await evaluate("document.querySelector('#start-button').click(); window.RadonOS.command('')");
  await sleep(500);
  await shot('ui-command');

  await evaluate("document.querySelector('#cmdk-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); document.querySelector('#command-bar').hidden = true");

  await evaluate('window.RadonOS.showAbout()');
  await sleep(500);
  await shot('ui-modal');
  await evaluate("document.querySelector('.ros-modal-backdrop')?.remove()");

  await evaluate("document.querySelector('#desktop').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:420,clientY:320}))");
  await sleep(400);
  await shot('ui-menu');
  await evaluate("document.querySelector('.ros-menu')?.remove()");

  await evaluate("document.querySelector('#tray-control').click()");
  await sleep(600);
  await shot('ui-control');
  await evaluate("document.querySelector('#cc-close').click()");
  await sleep(250);

  await evaluate("window.RadonOS.wm.open('settings')");
  await sleep(3200);
  console.log('  settings overview:', JSON.stringify(await evaluate(`(() => {
    const w = window.RadonOS.wm.findByApp('settings');
    const d = w.iframe.contentDocument;
    return {
      iframeH: Math.round(w.iframe.getBoundingClientRect().height),
      tiles: d.querySelectorAll('[data-item]').length,
      crumbHidden: d.querySelector('#crumb').hidden,
    };
  })()`)));
  await shot('ui-settings');

  await evaluate(`(() => {
    const d = window.RadonOS.wm.findByApp('settings').iframe.contentDocument;
    d.querySelector('[data-item="theme"]').click();
  })()`);
  await sleep(900);
  await shot('ui-settings-theme');

  await evaluate(`(() => {
    const d = window.RadonOS.wm.findByApp('settings').iframe.contentDocument;
    d.querySelector('[data-back]').click();
    d.querySelector('[data-section="system"]').click();
  })()`);
  await sleep(900);
  await shot('ui-settings-system');

  await evaluate(`(() => {
    const d = window.RadonOS.wm.findByApp('settings').iframe.contentDocument;
    d.querySelector('[data-item="clock"]').click();
  })()`);
  await sleep(900);
  await shot('ui-settings-clock');

  await evaluate("window.RadonOS.wm.open('explorer')");
  await sleep(1600);
  await shot('ui-explorer');

  await evaluate("window.RadonOS.wm.open('notepad')");
  await sleep(1400);
  await shot('ui-notepad');

  await evaluate("window.RadonOS.wm.open('media')");
  await sleep(1400);
  await shot('ui-media');

  await evaluate("window.RadonOS.wm.open('terminal'); window.RadonOS.wm.open('browser')");
  await sleep(1800);
  await shot('ui-terminal-browser');

  await evaluate("window.RadonOS.updateSettings({ theme: 'light' })");
  await sleep(1400);
  await shot('ui-light');
  await evaluate("window.RadonOS.updateSettings({ theme: 'dark' })");
} finally {
  cdp?.socket.close();
  browser.kill();
}
