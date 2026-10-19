import * as FS from '../../shared/fs.js';
import { APPS, getApp, OS_VERSION, OS_CODENAME } from '../../shared/registry.js';
import { loadSettings, getSettings, updateSettings } from '../../shared/settings.js';
import { initTheme, WALLPAPERS } from '../../shared/theme.js';
import { vfs, dotfiles } from '../../shared/storageManager.js';
import * as PKG from '../../shared/radonpkg.js';
import { isExtension } from '../../shared/platform.js';
import { openApp, closeSelf, notifyOwner, escapeHtml, formatBytes, formatDate, paintIcons } from '../../shared/ui.js';

const $ = (selector) => document.querySelector(selector);
const output = $('#term-output');
const input = $('#term-input');
const cwdLabel = $('#prompt-cwd');

const state = {
  cwd: FS.ROOT_ID,
  history: [],
  historyIndex: -1,
  busy: false,
};

/* --------------------------------------------------------------- output */
function print(html, className = '') {
  const line = document.createElement('div');
  line.className = `term-line ${className}`;
  line.innerHTML = html;
  output.appendChild(line);
  output.scrollTop = output.scrollHeight;
  return line;
}

const escape = (value) => escapeHtml(value);

function printEcho(command) {
  print(
    `<span class="term-echo"><span class="sigil">$</span> ${escape(command)}</span>`,
  );
}

async function promptLabel() {
  const path = await FS.pathString(state.cwd);
  const display = path === '/' ? '~' : `~${path}`;
  cwdLabel.textContent = display;
  $('#cwd-label').textContent = display;
  return display;
}

/* ------------------------------------------------------------- utilities */
function tokenize(line) {
  const tokens = [];
  let current = '';
  let quote = null;
  for (const char of line) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

async function resolveTarget(target, { mustExist = true } = {}) {
  if (!target) {
    const node = await FS.get(state.cwd);
    return node;
  }
  const node = await FS.resolvePath(target, state.cwd);
  if (!node && mustExist) throw new Error(`Path not found: ${target}`);
  return node;
}

const pathOf = (node) => FS.pathString(node.id);

/** Total bytes of a node, walking folders depth-first. */
async function folderSize(node) {
  if (node.kind !== 'folder') return Number(node.size) || 0;
  const children = await FS.list(node.id);
  let total = 0;
  for (const child of children) total += await folderSize(child);
  return total;
}

/** Render a small aligned table into the terminal output. */
function printTable(headers, rows) {
  const table = document.createElement('div');
  table.className = 'term-line';
  const columns = headers.slice(1).map(() => 'max-content').join(' ');
  table.innerHTML = `<div class="term-table" style="grid-template-columns:${columns} minmax(0, 1fr)">
    ${headers.map((header) => `<div class="h">${escape(header)}</div>`).join('')}
    ${rows.map((row) => row.map((cell) => `<div>${cell}</div>`).join('')).join('')}
  </div>`;
  output.appendChild(table);
  output.scrollTop = output.scrollHeight;
  return table;
}

/**
 * Split a shell argument into its parent folder node and final name, so
 * `mkdir /Documents/Notes` and `touch ./todo.txt` both work.
 */
async function splitTarget(target) {
  const name = target.slice(target.lastIndexOf('/') + 1).trim();
  if (!name) throw new Error('Missing name');
  const dirArg = target.includes('/') ? target.slice(0, target.lastIndexOf('/')) || '/' : null;
  const parent = dirArg ? await FS.resolvePath(dirArg, state.cwd) : await FS.get(state.cwd);
  if (!parent || parent.kind !== 'folder') throw new Error(`Folder not found: ${dirArg || target}`);
  return { parent, name };
}

/* -------------------------------------------------------------- calculator */
function evaluate(expression) {
  const tokens = String(expression).match(/\d+\.?\d*|[+\-*/%^()]/g);
  if (!tokens) throw new Error('Nothing to calculate');
  let position = 0;

  const peek = () => tokens[position];
  const eat = (token) => {
    if (tokens[position] === token) {
      position += 1;
      return true;
    }
    return false;
  };

  const parseExpression = () => {
    let value = parseTerm();
    for (;;) {
      if (eat('+')) value += parseTerm();
      else if (eat('-')) value -= parseTerm();
      else return value;
    }
  };
  const parseTerm = () => {
    let value = parsePower();
    for (;;) {
      if (eat('*')) value *= parsePower();
      else if (eat('/')) value /= parsePower();
      else if (eat('%')) value %= parsePower();
      else return value;
    }
  };
  const parsePower = () => {
    const base = parseUnary();
    if (eat('^')) return base ** parsePower();
    return base;
  };
  const parseUnary = () => {
    if (eat('-')) return -parseUnary();
    if (eat('+')) return parseUnary();
    return parseAtom();
  };
  const parseAtom = () => {
    if (eat('(')) {
      const value = parseExpression();
      if (!eat(')')) throw new Error('Missing closing parenthesis');
      return value;
    }
    const token = peek();
    if (!token || Number.isNaN(Number(token))) throw new Error('Invalid expression');
    position += 1;
    return Number(token);
  };

  const result = parseExpression();
  if (position !== tokens.length) throw new Error('Invalid expression');
  if (!Number.isFinite(result)) throw new Error('Result is not a number');
  return result;
}

/* --------------------------------------------------------------- commands */
const COMMANDS = {
  help: {
    usage: 'help [command]',
    description: 'Show available commands',
    async run([topic]) {
      const entry = COMMANDS[topic] || PKG.installedTools()[topic];
      if (topic && entry) {
        print(`<b>${topic}</b> — ${escape(entry.description)}`);
        print(`usage: <span class="accent">${escape(entry.usage)}</span>`);
        return;
      }
      print('<b>RadonOS shell commands</b>');
      const tools = PKG.installedTools();
      for (const name of [...new Set([...Object.keys(COMMANDS), ...Object.keys(tools)])].sort()) {
        const entry = COMMANDS[name] || tools[name];
        const usage = entry.usage.replace(name, '').trim();
        const tag = COMMANDS[name] ? '' : ' <span class="dim">(pkg)</span>';
        print(`<span class="accent">${escape(name.padEnd(10, ' '))}</span> <span class="dim">${escape(usage.padEnd(26, ' '))}</span> ${escape(entry.description)}${tag}`);
      }
      print('');
      print('Tip: use <span class="accent">apps</span>, <span class="accent">neofetch</span> or <span class="accent">radonpkg search</span> to add tools.', 'dim');
    },
  },

  banner: {
    usage: 'banner',
    description: 'Print the RadonOS banner',
    async run() { banner(); },
  },

  clear: {
    usage: 'clear',
    description: 'Clear the screen',
    async run() {
      output.innerHTML = '';
    },
  },

  date: {
    usage: 'date',
    description: 'Show the current date and time',
    async run() {
      print(new Date().toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' }));
      print(`Epoch: ${Date.now()}`, 'dim');
    },
  },

  time: {
    usage: 'time',
    description: 'Show the current time',
    async run() {
      const settings = getSettings();
      print(new Date().toLocaleTimeString([], { hour12: !settings.clock24 }));
    },
  },

  echo: {
    usage: 'echo <text> [> file]',
    description: 'Print text, optionally writing it to a file',
    async run(args, raw) {
      const redirect = raw.indexOf('>');
      if (redirect !== -1) {
        const text = raw.slice(0, redirect).trim();
        const target = raw.slice(redirect + 1).trim();
        if (!target) throw new Error('Missing redirect target');
        const node = await FS.resolvePath(target, state.cwd);
        if (node) {
          await FS.writeText({ id: node.id, content: `${text}\n` });
          print(`Wrote ${text.length + 1} bytes to ${await pathOf(node)}`, 'ok');
        } else {
          const dir = target.includes('/') ? target.slice(0, target.lastIndexOf('/')) || '/' : null;
          const name = target.slice(target.lastIndexOf('/') + 1);
          const parent = dir ? await FS.resolvePath(dir, state.cwd) : await FS.get(state.cwd);
          if (!parent) throw new Error(`Folder not found: ${dir}`);
          const created = await FS.createFile(parent.id, name, `${text}\n`);
          print(`Created ${await pathOf(created)}`, 'ok');
        }
        return;
      }
      print(escape(args.join(' ')));
    },
  },

  ls: {
    usage: 'ls [-l] [path]',
    description: 'List folder contents',
    async run(args) {
      const long = args.includes('-l') || args.includes('-la');
      const targetArg = args.find((arg) => !arg.startsWith('-'));
      const target = await resolveTarget(targetArg);
      if (target.kind === 'file') {
        print(`${escape(target.name)}  ${formatBytes(target.size || 0)}`);
        return;
      }
      const nodes = await FS.list(target.id);
      if (!nodes.length) {
        print('(empty folder)', 'dim');
        return;
      }
      if (!long) {
        print(nodes.map((node) => (
          node.kind === 'folder'
            ? `<span style="color:#7dd3fc">${escape(node.name)}/</span>`
            : escape(node.name)
        )).join('   '));
        print(`${nodes.length} item${nodes.length === 1 ? '' : 's'}`, 'dim');
        return;
      }
      const table = document.createElement('div');
      table.className = 'term-line';
      table.innerHTML = `
        <div class="term-table">
          <div class="h">type</div><div class="h">size</div><div class="h">modified</div><div class="h">name</div>
          ${nodes.map((node) => `
            <div class="${node.kind === 'folder' ? 'dir' : 'file'}">${node.kind === 'folder' ? 'dir' : 'file'}</div>
            <div>${node.kind === 'folder' ? '—' : formatBytes(node.size || 0)}</div>
            <div>${formatDate(node.updatedAt)}</div>
            <div class="${node.kind === 'folder' ? 'dir' : 'file'}">${escape(node.name)}</div>`).join('')}
        </div>`;
      output.appendChild(table);
      output.scrollTop = output.scrollHeight;
    },
  },

  cd: {
    usage: 'cd [path]',
    description: 'Change the current folder',
    async run([target]) {
      if (!target || target === '~') {
        state.cwd = FS.ROOT_ID;
        await promptLabel();
        return;
      }
      const node = await resolveTarget(target);
      if (node.kind !== 'folder') throw new Error('Not a folder');
      state.cwd = node.id;
      await promptLabel();
    },
  },

  pwd: {
    usage: 'pwd',
    description: 'Print the working directory',
    async run() {
      print(await FS.pathString(state.cwd));
    },
  },

  cat: {
    usage: 'cat <file>',
    description: 'Print a text file',
    async run([target]) {
      if (!target) throw new Error('Usage: cat <file>');
      const node = await resolveTarget(target);
      if (node.kind === 'folder') throw new Error('Cannot cat a folder');
      const kind = FS.kindForMime(node.mime);
      const path = await pathOf(node);
      if (kind !== 'text' && kind !== 'binary') {
        print(`${escape(node.name)} is ${node.mime} (${formatBytes(node.size || 0)}) — binary file`, 'dim');
        return;
      }
      const text = await FS.readText(node.id);
      const pre = document.createElement('div');
      pre.className = 'term-line';
      pre.innerHTML = `<pre>${escape(text || '')}</pre>`;
      output.appendChild(pre);
      output.scrollTop = output.scrollHeight;
      print(`${text?.length || 0} chars · ${path}`, 'dim');
    },
  },

  mkdir: {
    usage: 'mkdir <path>',
    description: 'Create a folder (absolute or relative path)',
    async run(args) {
      const target = args.join(' ').trim();
      if (!target) throw new Error('Usage: mkdir /Documents/New folder');
      const { parent, name } = await splitTarget(target);
      const node = await FS.mkdir(parent.id, name);
      print(`Created folder ${escape(await FS.pathString(node.id))}`, 'ok');
    },
  },

  touch: {
    usage: 'touch <path>',
    description: 'Create an empty file (absolute or relative path)',
    async run(args) {
      const target = args.join(' ').trim();
      if (!target) throw new Error('Usage: touch /Documents/notes.txt');
      const { parent, name } = await splitTarget(target);
      const node = await FS.createFile(parent.id, name, '');
      print(`Created ${escape(await FS.pathString(node.id))}`, 'ok');
    },
  },

  rm: {
    usage: 'rm <path>',
    description: 'Move a file or folder to the trash',
    async run([target]) {
      if (!target) throw new Error('Usage: rm <path>');
      const node = await resolveTarget(target);
      await FS.trash(node.id);
      print(`Moved ${escape(node.name)} to trash`, 'ok');
    },
  },

  mv: {
    usage: 'mv <source> <destination>',
    description: 'Rename or move a file/folder',
    async run([source, destination]) {
      if (!source || !destination) throw new Error('Usage: mv <source> <destination>');
      const node = await resolveTarget(source);
      const target = await FS.resolvePath(destination, state.cwd);
      if (target?.kind === 'folder') {
        const moved = await FS.move(node.id, target.id);
        print(`Moved to ${await pathOf(moved)}`, 'ok');
        return;
      }
      const renamed = await FS.rename(node.id, destination);
      print(`Renamed to ${escape(renamed.name)}`, 'ok');
    },
  },

  cp: {
    usage: 'cp <source> <new name>',
    description: 'Copy a file',
    async run([source, destination]) {
      if (!source || !destination) throw new Error('Usage: cp <source> <new name>');
      const node = await resolveTarget(source);
      if (node.kind === 'folder') throw new Error('Copying folders is not supported yet');
      const blob = await FS.readBlob(node.id);
      const created = await FS.writeBlob(node.parentId, new File([blob], destination, { type: node.mime }));
      print(`Copied to ${escape(created.name)}`, 'ok');
    },
  },

  open: {
    usage: 'open <app|url> [argument]',
    description: 'Launch a RadonOS app or open a URL',
    async run([target, ...rest]) {
      if (!target) throw new Error('Usage: open <app|url> [argument]');
      if (/^https?:\/\//i.test(target)) {
        openApp('browser', { url: target });
        print(`Opening ${escape(target)} in the RadonOS browser`, 'ok');
        return;
      }
      const app = getApp(target);
      if (!app) throw new Error(`Unknown app: ${target} (try: apps)`);
      const argument = rest.join(' ');
      let args = {};
      if (keyIsPath(app)) {
        if (argument) {
          const node = await FS.resolvePath(argument, state.cwd);
          args.path = node ? await pathOf(node) : argument;
        } else {
          args.path = await FS.pathString(state.cwd);
        }
      }
      openApp(app.id, args);
      print(`Launching ${escape(app.name)}${args.path ? ` with ${escape(args.path)}` : ''}`, 'ok');
    },
  },

  apps: {
    usage: 'apps',
    description: 'List installed apps',
    async run() {
      const table = document.createElement('div');
      table.className = 'term-line';
      table.innerHTML = `<div class="term-table">
        <div class="h">id</div><div class="h">name</div><div class="h">window</div><div class="h">description</div>
        ${APPS.map((app) => `
          <div class="accent">${escape(app.id)}</div>
          <div>${escape(app.name)}</div>
          <div>${app.width}×${app.height}</div>
          <div class="dim">${escape(app.description)}</div>`).join('')}
      </div>`;
      output.appendChild(table);
      output.scrollTop = output.scrollHeight;
    },
  },

  theme: {
    usage: 'theme [dark|light|auto|accent #hex]',
    description: 'Change the desktop theme',
    async run(args) {
      const [mode, key, value] = args;
      if (key === 'accent' && value) {
        await updateSettings({ accent: value });
        print(`Accent set to ${escape(value)}`, 'ok');
        return;
      }
      if (!mode) {
        const settings = getSettings();
        print(`theme: ${settings.theme} · accent: ${settings.accent}`);
        return;
      }
      if (mode === 'accent') {
        throw new Error('Usage: theme accent #5b9dff');
      }
      if (!['dark', 'light', 'auto'].includes(mode)) throw new Error('Mode must be dark, light or auto');
      await updateSettings({ theme: mode });
      print(`Theme set to ${mode}`, 'ok');
    },
  },

  wallpaper: {
    usage: 'wallpaper [preset|url]',
    description: 'Change the desktop wallpaper',
    async run([target]) {
      if (!target) {
        print(`presets: ${WALLPAPERS.map((item) => item.id).join(', ')}`, 'dim');
        print(`current: ${getSettings().wallpaper.value}`);
        return;
      }
      if (/^https?:\/\//i.test(target)) {
        await updateSettings({ wallpaper: { ...getSettings().wallpaper, type: 'url', value: target } });
        print('Wallpaper updated from URL', 'ok');
        return;
      }
      if (!WALLPAPERS.some((item) => item.id === target)) throw new Error(`Unknown preset: ${target}`);
      await updateSettings({ wallpaper: { ...getSettings().wallpaper, type: 'preset', value: target } });
      print(`Wallpaper set to ${target}`, 'ok');
    },
  },

  notify: {
    usage: 'notify <text>',
    description: 'Send a RadonOS notification',
    async run(args) {
      const body = args.join(' ');
      if (!body) throw new Error('Usage: notify <text>');
      notifyOwner({ title: 'Terminal', body, iconName: 'terminal' });
      print('Notification sent', 'ok');
    },
  },

  mem: {
    usage: 'mem',
    description: 'Show memory and storage usage',
    async run() {
      const memory = performance.memory;
      if (memory) {
        const used = formatBytes(memory.usedJSHeapSize);
        const total = formatBytes(memory.jsHeapSizeLimit);
        print(`JS heap: ${used} / ${total} (${((memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100).toFixed(1)}%)`);
      } else {
        print('performance.memory is not exposed in this browser', 'dim');
      }
      const estimate = await navigator.storage?.estimate?.().catch(() => null);
      if (estimate) {
        print(`Storage: ${formatBytes(estimate.usage || 0)} / ${formatBytes(estimate.quota || 0)}`);
      }
      print(`CPU threads: ${navigator.hardwareConcurrency || '?'}`, 'dim');
    },
  },

  df: {
    usage: 'df',
    description: 'Show virtual disk usage',
    async run() {
      const stats = await FS.stats();
      const estimate = await navigator.storage?.estimate?.().catch(() => null);
      print('<b>Filesystem</b>   Size      Used      Free      Use%   Mounted');
      const quota = estimate?.quota || 0;
      const used = estimate?.usage || stats.bytes;
      const percent = quota ? ((used / quota) * 100).toFixed(1) : '—';
      print(`RadonOS-VFS  ${formatBytes(quota || 0).padEnd(9)} ${formatBytes(used).padEnd(9)} ${formatBytes(Math.max(0, quota - used)).padEnd(9)} ${String(percent).padEnd(6)} /`);
      print(`Cells: ${stats.files} files · ${stats.folders} folders · ${stats.trash} in trash`, 'dim');
    },
  },

  vfs: {
    usage: 'vfs <ls|cat|write|rm|du|find|dotfiles> [...]',
    description: 'Query the virtual file system by path',
    async run(args) {
      const [action = 'ls', ...rest] = args;

      if (action === 'ls') {
        const entries = await vfs.list(rest[0] || '.', { cwd: state.cwd });
        if (!entries.length) {
          print('(empty folder)', 'dim');
          return;
        }
        printTable(['kind', 'size', 'modified', 'path'], entries.map((entry) => [
          entry.kind === 'folder' ? `<span class="accent">folder</span>` : 'file',
          `<span class="dim">${entry.kind === 'folder' ? '—' : escape(formatBytes(entry.size))}</span>`,
          `<span class="dim">${escape(formatDate(entry.updatedAt))}</span>`,
          escape(entry.path),
        ]));
        print(`${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`, 'dim');
        return;
      }

      if (action === 'cat') {
        if (!rest[0]) throw new Error('Usage: vfs cat <path>');
        const text = await vfs.read(rest[0], { cwd: state.cwd });
        print(`<pre class="term-pre">${escape(text)}</pre>`);
        return;
      }

      if (action === 'write') {
        const [target, ...words] = rest;
        if (!target) throw new Error('Usage: vfs write <path> <text>');
        const content = words.join(' ');
        const node = await vfs.write(target, content, { cwd: state.cwd });
        print(`wrote ${formatBytes(content.length)} to ${escape(await FS.pathString(node.id))}`, 'ok');
        return;
      }

      if (action === 'rm') {
        const permanent = rest.includes('--force') || rest.includes('-f');
        const target = rest.find((arg) => !arg.startsWith('-'));
        if (!target) throw new Error('Usage: vfs rm <path> [--force]');
        const removed = await vfs.remove(target, { cwd: state.cwd, permanent });
        print(`${permanent ? 'deleted' : 'moved to trash'}: ${escape(removed.path)}`, 'ok');
        return;
      }

      if (action === 'du') {
        const node = await resolveTarget(rest[0]);
        const bytes = await folderSize(node);
        print(`${escape(await FS.pathString(node.id))} · ${formatBytes(bytes)} · ${node.kind}`, 'accent');
        if (node.kind === 'folder') {
          const children = await FS.list(node.id);
          print(`${children.length} direct entr${children.length === 1 ? 'y' : 'ies'}`, 'dim');
        }
        return;
      }

      if (action === 'find') {
        const term = rest.join(' ').trim();
        if (!term) throw new Error('Usage: vfs find <term>');
        const hits = await vfs.find(term);
        if (!hits.length) {
          print('No matches', 'dim');
          return;
        }
        for (const hit of hits.slice(0, 30)) {
          print(`${hit.kind === 'folder' ? '<span class="accent">folder</span>' : 'file'} ${escape(hit.path)}`, 'dim');
        }
        print(`${hits.length} match${hits.length === 1 ? '' : 'es'}`, 'ok');
        return;
      }

      if (action === 'dotfiles') {
        const entries = await dotfiles.list();
        if (!entries.length) {
          print('No dotfiles yet — install a package to create one', 'dim');
          return;
        }
        printTable(['name', 'path'], entries.map((entry) => [
          escape(entry.name),
          `<span class="dim">${escape(entry.path)}</span>`,
        ]));
        return;
      }

      throw new Error('Usage: vfs <ls|cat|write|rm|du|find|dotfiles> [...]');
    },
  },

  uname: {
    usage: 'uname [-a]',
    description: 'Print the RadonOS release and host details',
    async run(args) {
      const host = isExtension ? 'chromium-extension' : 'web';
      print(`RadonOS ${OS_CODENAME} ${OS_VERSION} ${host} ${navigator.userAgentData?.platform || navigator.platform || 'unknown'}`);
      if (!args.includes('-a')) return;
      const engine = navigator.userAgent.match(/Chrom(?:e|ium)\/([\d.]+)/)?.[1] || 'unknown';
      const settings = getSettings();
      print(`engine:   Chromium ${engine}`, 'dim');
      print(`vendor:   ${navigator.vendor || 'unknown'}`, 'dim');
      print(`threads:  ${navigator.hardwareConcurrency || '?'}`, 'dim');
      print(`theme:    ${settings.theme} · palette ${settings.palette} · dock ${settings.dock}`, 'dim');
      print(`packages: ${PKG.installedIds().join(', ') || '(none)'}`, 'dim');
    },
  },

  radonpkg: {
    usage: 'radonpkg <search|install|remove|list|info> [...]',
    description: 'Install extra shell tools',
    async run(args) {
      const [action = 'list', ...rest] = args;

      if (action === 'search') {
        const hits = PKG.search(rest.join(' '));
        if (!hits.length) {
          print('No packages matched', 'dim');
          return;
        }
        printTable(['package', 'version', 'size', 'status', 'description'], hits.map((pkg) => [
          `<span class="accent">${escape(pkg.name)}</span>`,
          `<span class="dim">${escape(pkg.version)}</span>`,
          `<span class="dim">${escape(pkg.size)}</span>`,
          PKG.isInstalled(pkg.id) ? '<span class="ok">installed</span>' : '—',
          `<span class="dim">${escape(pkg.description)}</span>`,
        ]));
        print('Install with <span class="accent">radonpkg install &lt;package&gt;</span>', 'dim');
        return;
      }

      if (action === 'install') {
        const id = rest[0];
        if (!id) throw new Error('Usage: radonpkg install <package>');
        const pkg = await PKG.install(id);
        print(`installed ${escape(pkg.name)} ${escape(pkg.version)}`, 'ok');
        print(`new commands: ${pkg.commands.map((name) => `<span class="accent">${escape(name)}</span>`).join(', ')}`, 'dim');
        print(`manifest: ${escape(PKG.MANIFEST_DIR)}/${escape(pkg.id)}.json`, 'dim');
        return;
      }

      if (action === 'remove' || action === 'uninstall') {
        const id = rest[0];
        if (!id) throw new Error('Usage: radonpkg remove <package>');
        const pkg = await PKG.remove(id);
        print(`removed ${escape(pkg.name)} — commands ${pkg.commands.join(', ')} are gone`, 'ok');
        return;
      }

      if (action === 'list') {
        const installed = PKG.installedPackages();
        if (!installed.length) {
          print('No packages installed. Try <span class="accent">radonpkg search</span>.', 'dim');
          return;
        }
        for (const pkg of installed) {
          print(`<span class="accent">${escape(pkg.name)}</span> ${escape(pkg.version)} <span class="dim">— ${escape(pkg.commands.join(', '))}</span>`);
        }
        return;
      }

      if (action === 'info') {
        const pkg = PKG.PACKAGE_MAP.get(rest[0]);
        if (!pkg) throw new Error(`No such package: ${rest[0] || '(none)'}`);
        print(`<b>${escape(pkg.name)}</b> ${escape(pkg.version)} · ${escape(pkg.size)}`);
        print(escape(pkg.description));
        print(`commands: ${pkg.commands.map((name) => `<span class="accent">${escape(name)}</span>`).join(', ')}`, 'dim');
        print(`tags: ${escape(pkg.tags)}`, 'dim');
        print(`status: ${PKG.isInstalled(pkg.id) ? 'installed' : 'not installed'}`, 'dim');
        return;
      }

      throw new Error('Usage: radonpkg <search|install|remove|list|info> [...]');
    },
  },

  whoami: {
    usage: 'whoami',
    description: 'Show the current user',
    async run() {
      print(getSettings().userName || 'radon');
      print('Local session · no account required', 'dim');
    },
  },

  history: {
    usage: 'history',
    description: 'Show recent commands',
    async run() {
      if (!state.history.length) {
        print('No history yet', 'dim');
        return;
      }
      state.history.slice(-40).forEach((entry, index) => print(`${String(index + 1).padStart(3, ' ')}  ${escape(entry)}`, 'dim'));
    },
  },

  tabs: {
    usage: 'tabs',
    description: 'List your open browser tabs (extension only)',
    async run() {
      const host = window.parent?.RadonOS;
      if (!host || !globalThis.chrome?.tabs) {
        print('Tab listing is only available inside the installed extension', 'dim');
        return;
      }
      const found = await chrome.tabs.query({}).catch(() => []);
      const list = found.filter((tab) => tab.url && !tab.url.startsWith('chrome-extension://'));
      if (!list.length) {
        print('No other tabs', 'dim');
        return;
      }
      list.slice(0, 20).forEach((tab) => print(`${tab.active ? '*' : ' '} ${escape(tab.title || '')} — <span class="dim">${escape(tab.url)}</span>`));
    },
  },

  calc: {
    usage: 'calc <expression>',
    description: 'Evaluate an arithmetic expression',
    async run(args) {
      const expression = args.join(' ');
      if (!expression) throw new Error('Usage: calc 2 * (3 + 4)');
      const result = evaluate(expression);
      print(`${escape(expression)} = <b>${result}</b>`);
    },
  },

  neofetch: {
    usage: 'neofetch',
    description: 'Print a system summary',
    async run() { await neofetch(); },
  },

  about: {
    usage: 'about',
    description: 'About RadonOS',
    async run() {
      print(`<b>RadonOS ${OS_VERSION}</b> “${OS_CODENAME}” — a desktop environment for your new tab page.`);
      print('Manifest V3 · IndexedDB virtual file system · zero remote assets.', 'dim');
      window.parent?.RadonOS?.showAbout?.();
    },
  },

  exit: {
    usage: 'exit',
    description: 'Close this terminal window',
    async run() {
      print('Closing terminal…', 'dim');
      setTimeout(() => {
        if (!closeSelf()) window.close();
      }, 220);
    },
  },
};

function keyIsPath(app) {
  return ['explorer', 'notepad', 'media'].includes(app.id);
}

/* ---------------------------------------------------------------- banner */
function banner() {
  const art = `  ____            _               ____  _____
 |  _ \\ __ _  __| | ___  _ __   / __ \\/ ___|
 | |_) / _\` |/ _\` |/ _ \\| '_ \\ | |  | \\___ \\
 |  _ < (_| | (_| | (_) | | | || |__| |___) |
 |_| \\_\\__,_|\\__,_|\\___/|_| |_| \\____/|____/  v${OS_VERSION}`;
  const line = document.createElement('div');
  line.className = 'term-line accent';
  line.innerHTML = `<pre>${escape(art)}</pre>`;
  output.appendChild(line);
  print('Type <span class="accent">help</span> for commands · <span class="accent">neofetch</span> for system info', 'dim');
  print('');
}

async function neofetch() {
  const stats = await FS.stats();
  const windows = window.parent?.RadonOS?.windows?.list?.() || [];
  const memory = performance.memory;
  const logo = `   ╭──────────╮
   │  ◜◝   ◜◝  │
   │   ( ◉ )   │
   │  ◟◞   ◟◞  │
   ╰──────────╯`;
  const rows = [
    ['OS', `RadonOS ${OS_VERSION} “${OS_CODENAME}”`],
    ['Host', 'Chromium extension (MV3)'],
    ['Shell', 'radon-sh 1.0'],
    ['Windows', `${windows.filter((win) => !win.minimized).length} open / ${windows.length} total`],
    ['Files', `${stats.files} files, ${stats.folders} folders`],
    ['Disk', `${formatBytes(stats.bytes)} in the virtual file system`],
    ['Uptime', `${Math.floor(performance.now() / 1000)}s this session`],
    ['CPU', `${navigator.hardwareConcurrency || '?'} threads`],
    ['Memory', memory ? `${formatBytes(memory.usedJSHeapSize)} / ${formatBytes(memory.jsHeapSizeLimit)}` : 'not exposed'],
    ['Locale', navigator.language],
  ];
  const block = document.createElement('div');
  block.className = 'term-line';
  block.innerHTML = `<pre>${escape(logo)}      ${escape(rows[0][0])}: ${escape(rows[0][1])}\n${rows.slice(1).map(([key, value], index) => `${' '.repeat(18)}${escape(key.padEnd(8, ' '))}: ${escape(value)}`).join('\n')}</pre>`;
  output.appendChild(block);
  output.scrollTop = output.scrollHeight;
}

/* -------------------------------------------------------------- dispatch */
async function runCommand(line) {
  const trimmed = line.trim();
  if (!trimmed) return;
  state.history.push(trimmed);
  state.history = state.history.slice(-200);
  state.historyIndex = state.history.length;
  try {
    localStorage.setItem('radonos:term-history', JSON.stringify(state.history));
  } catch { /* ignore */ }

  const [name, ...rest] = tokenize(trimmed);
  // Installed radonpkg tools are resolved at dispatch time so `radonpkg
  // install` becomes usable immediately, without reloading the terminal.
  const tools = PKG.installedTools();
  const builtin = COMMANDS[name];
  const command = builtin || tools[name];
  if (!command) {
    print(`<span class="error">command not found: ${escape(name)}</span>`);
    const suggestions = [...new Set([...Object.keys(COMMANDS), ...Object.keys(tools)])]
      .filter((key) => key.startsWith(name[0] || ''))
      .slice(0, 6);
    if (suggestions.length) {
      print(`Did you mean: ${suggestions.map((s) => `<span class="accent">${s}</span>`).join(', ')}`, 'dim');
    }
    return;
  }
  // Built-ins take (args); package tools take (context, args) so they can
  // print, read the VFS and report sizes without importing terminal internals.
  if (builtin) await builtin.run(rest, trimmed.slice(name.length).trim());
  else await command.run({ print, escape, formatBytes, vfs, state }, rest);
}

async function submit() {
  const line = input.value;
  printEcho(line);
  input.value = '';
  state.busy = true;
  try {
    await runCommand(line);
  } catch (err) {
    print(`<span class="error">${escape(err.message || String(err))}</span>`);
  } finally {
    state.busy = false;
    await promptLabel();
    output.scrollTop = output.scrollHeight;
  }
}

/* ------------------------------------------------------------ completion */
async function complete() {
  const value = input.value;
  const tokens = value.split(/\s+/);
  const isFirst = tokens.length === 1;

  if (isFirst) {
    const prefix = tokens[0].toLowerCase();
    const matches = [...new Set([...Object.keys(COMMANDS), ...Object.keys(PKG.installedTools())])]
      .filter((name) => name.startsWith(prefix))
      .sort();
    applyCompletion(matches, prefix);
    return;
  }

  const prefix = tokens[tokens.length - 1];
  const slash = prefix.includes('/') ? prefix.slice(0, prefix.lastIndexOf('/') + 1) : '';
  const base = prefix.includes('/') ? prefix.slice(prefix.lastIndexOf('/') + 1) : prefix;
  const dir = await FS.resolvePath(slash || '.', state.cwd).catch(() => null);
  if (!dir || dir.kind !== 'folder') return;
  const entries = await FS.list(dir.id);
  const matches = entries
    .filter((node) => node.name.toLowerCase().startsWith(base.toLowerCase()))
    .map((node) => `${slash}${node.name}${node.kind === 'folder' ? '/' : ''}`);

  if (matches.length === 1) {
    tokens[tokens.length - 1] = matches[0];
    input.value = tokens.join(' ');
  } else if (matches.length > 1) {
    applyCompletion(matches, base, tokens);
  }
}

function applyCompletion(matches, base, tokens = null) {
  if (!matches.length) return;
  if (matches.length === 1) {
    if (tokens) {
      tokens[tokens.length - 1] = matches[0];
      input.value = tokens.join(' ');
    } else {
      input.value = `${matches[0]} `;
    }
    return;
  }
  const prefix = matches.reduce((common, value) => {
    let index = 0;
    while (index < common.length && index < value.length && common[index] === value[index]) index += 1;
    return common.slice(0, index);
  }, matches[0]);
  if (prefix.length > base.length) {
    if (tokens) {
      tokens[tokens.length - 1] = prefix;
      input.value = tokens.join(' ');
    } else {
      input.value = prefix;
    }
  }
  print(`<span class="term-suggest">${matches.slice(0, 12).map((match) => `<span class="term-chip">${escape(match)}</span>`).join('')}</span>`, 'dim');
  output.querySelectorAll('.term-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const text = chip.textContent;
      input.value = input.value.replace(/\S*$/, text);
      input.focus();
    });
  });
}

/* ----------------------------------------------------------------- wiring */
input.addEventListener('keydown', async (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    if (!state.busy) await submit();
    return;
  }
  if (event.key === 'Tab') {
    event.preventDefault();
    await complete();
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (!state.history.length) return;
    state.historyIndex = Math.max(0, state.historyIndex - 1);
    input.value = state.history[state.historyIndex] || '';
    return;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    state.historyIndex = Math.min(state.history.length, state.historyIndex + 1);
    input.value = state.history[state.historyIndex] || '';
    return;
  }
  if (event.ctrlKey && event.key.toLowerCase() === 'l') {
    event.preventDefault();
    output.innerHTML = '';
    return;
  }
  if (event.ctrlKey && event.key.toLowerCase() === 'c') {
    event.preventDefault();
    print(`<span class="term-echo"><span class="sigil">$</span> ${escape(input.value)}^C</span>`);
    input.value = '';
  }
});

document.addEventListener('click', (event) => {
  if (window.getSelection()?.toString()) return;
  if (event.target.closest('.app-toolbar')) return;
  input.focus();
});

$('#btn-clear').addEventListener('click', () => { output.innerHTML = ''; input.focus(); });
$('#btn-help').addEventListener('click', async () => {
  printEcho('help');
  await COMMANDS.help.run([], 'help');
  output.scrollTop = output.scrollHeight;
  input.focus();
});
$('#btn-files').addEventListener('click', () => openApp('explorer', { path: '/Documents' }));

/* ------------------------------------------------------------------- boot */
(async () => {
  await loadSettings();
  await initTheme();
  await FS.ready();
  paintIcons();
  try {
    state.history = JSON.parse(localStorage.getItem('radonos:term-history') || '[]');
    state.historyIndex = state.history.length;
  } catch { state.history = []; }

  banner();
  await promptLabel();
  input.focus();
})();

