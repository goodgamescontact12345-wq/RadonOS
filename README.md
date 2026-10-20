<div align="center">

<img src="assets/logo.svg" width="72" alt="RadonOS">

# RadonOS

**A virtual desktop environment that replaces your browser's new tab page.**

Manifest V3 · zero runtime dependencies · offline-first · works in Chrome, Edge, Brave, Vivaldi, Opera and Helium

</div>

---

RadonOS was built as from a youtube video i saw where someone built a basic operating system in a browser, i decided to take it to the next level.

Nothing leaves your machine. There is no backend, no account, no telemetry and no remote asset:
every icon, sound and wallpaper gradient is generated locally.

**[Try it without installing anything →](https://goodgamescontact12345-wq.github.io/RadonOS/)** the same
desktop, published as a static app on GitHub Pages (see [Hosted version](#hosted-version)).

## Contents

- [Feature tour](#feature-tour)
- [Install and test in a Chromium browser](#install-and-test-in-a-chromium-browser)
- [Hosted version](#hosted-version)
- [Development workflow](#development-workflow)
- [Architecture](#architecture)
- [Adding your own app](#adding-your-own-app)
- [Verification](#verification)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Limitations and roadmap](#limitations-and-roadmap)

## Feature tour

| System | What it does |
| --- | --- |
| **Desktop** | Wallpaper engine (8 gradients, custom image URL, uploaded image stored in IndexedDB, dim + blur), draggable auto-snapping icon grid, marquee selection, right-click menus, "new shortcut"/"new note", sort and refresh, drag-and-drop file import into `Downloads`. |
| **Window manager** | Floating windows with drag, 8-way resize, maximise/restore (double-click the title bar), edge snapping (left/right/top), **tiling layouts** (halves, quadrants, thirds, centred) via API, commands and `Alt`+`Shift` shortcuts, minimise with animation, z-order focus, keyboard cycling, per-app minimum sizes, and session restore after a reload. |
| **Taskbar** | Start button, search, running-app buttons with live status indicators, show-desktop strip, system tray (performance popover, volume with Web Audio master gain, Battery API status, theme toggle, notification centre) and a live clock with a month calendar. |
| **Start menu** | Pinned app grid plus a unified search over apps, actions, **files in the virtual file system** and your real browser tabs (extension mode). Footer with user, settings, about, lock and restart. |
| **Command bar** | `Super`+`Space` (or `Ctrl`/`Cmd`+`K`, or just `>`) opens a spotlight that searches open windows, apps, 16 system commands, files and the web in one ranked list — fuzzy matching, grouped results, `↑`/`↓`/`Tab`/`↵`, single-key execution. |
| **Control center** | Quick settings from the tray: brightness (overlay, not a filter), glass blur + saturation, master volume, theme and palette, dock placement/alignment, reduce motion, clock options. Sliders preview live and persist once per gesture. |
| **Widgets** | Live weather (Open-Meteo with offline demo fallback), autosaving sticky note, bookmark list with in-place add/remove, and a performance monitor (JS heap, storage quota, window count, uptime). |
| **Files** | Sidebar quick access, breadcrumbs, back/forward/up history, list + grid views, recursive search, new folder/file, uploads, drag-and-drop import, image preview, download (Blob out to disk), rename, duplicate, properties, multi-select, trash, restore and empty-trash. |
| **Notepad** | Opens and saves into the virtual file system, save-as, download, open-by-search dialog, word wrap and font toggles, live char/word/line counts, `Ctrl+S`/`Ctrl+O`/`Ctrl+N`, "show in Files". |
| **Terminal** | 27 built-in commands over the *real* file system with quoting, `>` redirection, tab completion, history, `Ctrl+L`/`Ctrl+C`: `ls -l`, `cat`, `mkdir`, `touch`, `rm`, `mv`, `cp`, `open`, `theme`, `wallpaper`, `notify`, `calc`, `df`, `mem`, `uname`, `vfs` (ls/cat/write/rm/du/find/dotfiles), `radonpkg`, `neofetch`, `tabs`, `exit`. Installed packages extend the command table live. |
| **radonpkg** | A real (offline) package manager: `radonpkg search|install|remove|list|info` installs six CLI tools (`json`, `base64`, `uuid`, `hash`, `sysmon`, `tidy`), writes a manifest to `/System/Packages`, and retires the command again on removal. |
| **Browser** | Address bar with search fallback, history, quick-link home screen, bookmark saving, and honest handling of frame-blocking sites (X-Frame-Options detection plus "open in a real tab"). |
| **Media** | Playlist from `/Music` and `/Videos`, audio player with a canvas visualiser (Web Audio analyser, synthesised fallback for CORS-restricted streams), video element, stream URLs, YouTube embeds, shuffle/repeat/volume/seek. |
| **Settings** | Five categories that drill into subcategory pages with a breadcrumb and circular back button. Appearance (theme dark/light/auto, 8 accents + custom colour, 4 palettes, liquid-glass blur/saturation/brightness, wallpaper presets/URL/upload, dim/blur), Desktop (widgets, weather city + units, icon labels, layout reset, dock position + app-strip alignment, boot animation, reduced motion), System (user name, clock format, badge clock, sounds and volume, lock/restart), Storage (usage bars, JSON export/import, trash cleanup, reset, full erase) and About (runtime stats, shortcuts, features). |

Everything is themed through CSS custom properties, so light/dark, palette, glass and accent changes apply
instantly to every open window through a `chrome.storage` subscription. The visual language is a deep
petrol/navy glass desktop: 20px cards, hairline edges, wide-tracked uppercase section labels, pill
controls and vivid gradient app tiles (the `.ros-tile` recipe, driven per app by `--tile-color` from
`shared/registry.js`). Four palettes (Midnight, Lavender, Sage, Peach) retint the same surfaces in both
modes, `shared/themeEngine.css` owns the glass/radius/tile tokens, and the dock is a `data-dock`
attribute that flips the floating taskbar, window layer, start menu and popovers together.

## Install and test in a Chromium browser

1. Open the extensions page in your browser:
   - Chrome / Brave / Vivaldi / Opera: `chrome://extensions`
   - Edge: `edge://extensions`
   - Helium: `helium://extensions` (or the equivalent Chromium page)
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select the `radonos/` folder (the one containing `manifest.json`).
4. Click **Open a new tab** — or press `Alt+Shift+R`. The RadonOS desktop should appear.
5. Optional: click the toolbar icon (the atom) to open the desktop in a new tab; right-click a link on any
   page to **Open link in RadonOS** or **Save link to RadonOS bookmarks**.

**Verify it is live** (takes 30 seconds):

- Paste `chrome-extension://<your-extension-id>/newtab/index.html` into the address bar — the desktop
  should load there too.
- Open a window, drag it to the left edge to snap, minimise it, then reload the tab: the session comes back.
- Open **Terminal**, run `neofetch`, then `ls /Documents` — you should see `Welcome.txt` and
  `RadonOS Cheatsheet.md`.
- Right-click the desktop → **Change background** to confirm the Settings app can reach the desktop.

## Hosted version

RadonOS also runs as a plain website, which is the fastest way to try it and needs no extension at all.
Because every `chrome.*` call already funnels through `shared/platform.js`, the hosted build uses the
localStorage + BroadcastChannel fallback and behaves identically — except that it has no access to your
real browser tabs (start-menu search then covers apps, actions and files) and cannot set the toolbar
badge clock.

| Environment | URL |
| --- | --- |
| Production (GitHub Pages) | <https://goodgamescontact12345-wq.github.io/RadonOS/> |

The site lives at `https://<user>.github.io/RadonOS/`, i.e. on a **project subpath** rather than an
origin root, so the build only ever emits relative URLs — which also means the same `site/dist/` works
on a user page, a custom domain or any other static host.

```bash
npm run site:build   # assemble site/dist (50 files, ~500 KiB) with the origin root as base
npm run site:build -- --base /RadonOS   # the project-page shape CI builds
npm run site:dev     # build, then serve site/dist the way GitHub Pages would, on :8787
npm run site:test    # crawl that build over HTTP (pass an origin for a deployment)
node tools/e2e.mjs --url=https://your-deployment/   # full UI suite against a live origin
```

How it is published:

- **`.github/workflows/pages.yml`** — on every push to `main` (and on demand) it builds the site, uploads
  `site/dist` as the Pages artifact and deploys it. There is nothing to install: the build is plain Node.
  One-time setup per repository: **Settings → Pages → Source: GitHub Actions**.
- **`tools/build-site.mjs`** — copies `newtab/`, `apps/`, `shared/`, `icons/` and `assets/` into
  `site/dist/`, generates the two entry documents, injects a `<meta>` CSP into every document (GitHub
  Pages cannot send response headers), and refuses to ship maps, keys, the extension manifest or tooling.
- **`index.html` + `404.html` + `site/redirect.js`** — the only URL behaviour a static host cannot do on
  its own. `/` and unknown paths both load the redirect script, which sends the visitor to `newtab/`
  keeping the query string and hash, so `?app=terminal` still deep-links. The script resolves the desktop
  from its own `<script src>`, so it works under a subpath and at any depth; it is external because the
  CSP forbids inline scripts, and both documents carry a `<noscript>` refresh as a fallback.
- **The base path is baked in — for `404.html` only.** GitHub Pages serves it *at the requested URL*,
  so a relative `redirect.js` inside it would resolve to `/RadonOS/a/b/redirect.js` on a miss below
  `/a/b/`. The build therefore takes `--base`/`SITE_BASE`; the workflow derives it from the repository
  name and switches to the origin root for a `<user>.github.io` page or when the `PAGES_CUSTOM_DOMAIN`
  variable is set. `index.html` needs no base at all — it is always served from the site root, so its
  links stay relative and follow the domain on their own. Every app document is relative too.
- **`.nojekyll`** — the artifact is published verbatim, and this also keeps `_`-prefixed paths intact if
  the site is ever switched to branch publishing.
- **No server state at all.** Settings, files and wallpapers stay in the visitor's browser; Pages only
  serves files. There is no auth, no database and no secret.

The policy keeps `frame-src *` and `style-src 'unsafe-inline'` because the desktop embeds its own apps in
same-origin iframes and themes itself with inline custom properties. `frame-ancestors` cannot be expressed
in a meta tag, so on GitHub Pages it is simply absent.

### Changing the URL

The deployment follows the repository, so the two common moves need no code edit — rename the repository
and the next push rebuilds with the new base path:

| You want | Do this |
| --- | --- |
| A different project path, `/<repo>/` | Rename the repository. The workflow recomputes the base from the name, and the site moves with it. |
| An origin-root site, `https://<user>.github.io/` | Name the repository `<user>.github.io`; the workflow then builds with an empty base. |
| Your own domain, e.g. `radon.os` | **Settings → Pages → Custom domain**, add the DNS records below, enable *Enforce HTTPS*, then set the `PAGES_CUSTOM_DOMAIN` repository variable (**Settings → Secrets and variables → Actions → Variables**) so `404.html` stops prefixing `/RadonOS/`. |

DNS for a custom domain, pointing at GitHub Pages:

- **Subdomain** (`os.example.com`): a `CNAME` record to `<user>.github.io`.
- **Apex/root** (`example.com`): `A` records to `185.199.108.153`, `185.199.109.153`, `185.199.110.153`,
  `185.199.111.153`, plus `AAAA` records to `2606:50c0:8000::153`, `2606:50c0:8001::153`,
  `2606:50c0:8002::153`, `2606:50c0:8003::153` — or an `ALIAS`/`ANAME` to `<user>.github.io` if your
  DNS provider supports it.

After the domain is verified and *Enforce HTTPS* is on, GitHub serves the site from the new domain and
redirects the old `github.io` URL to it. Then redeploy (push, or *Re-run all jobs*) so the 404 page picks
up the root base, and update the links in this README.

> The virtual file system and settings live in the browser's per-origin storage, so they do **not** follow
the site to a new domain — export from **Settings → Storage** beforehand if you want to carry data over.

**Troubleshooting**

| Symptom | Fix |
| --- | --- |
| `https://<user>.github.io/RadonOS/` returns 404 | Pages is not enabled yet: **Settings → Pages → Source: GitHub Actions**, then re-run the `Deploy to GitHub Pages` workflow (a new push works too). |
| The hosted site still shows an older build | Check the latest `Deploy to GitHub Pages` run in the Actions tab; Pages serves the last successful deployment. |
| New tabs still show the old page | Another extension is overriding the new tab page (e.g. a theme or a search extension). Disable it, or use step 5 above. |
| `Service worker (Inactive)` in `chrome://extensions` | Normal for MV3: it starts on demand. Click *Inspect views → service worker* to see its console. |
| Nothing appears after editing files | Click the ↻ **Reload** button on the RadonOS card in the extensions page. |
| Files disappeared | RadonOS data lives in the browser profile's own origin storage. Incognito windows and other profiles have their own virtual disk; "Clear browsing data → Cookies and site data" removes it. |

> **Note for Chrome/Edge 137+:** `--load-extension` on the command line is disabled in recent stable
> builds, so automated suites cannot launch the extension directly. Load it once by hand as above
> (developer mode), then use `npm run e2e:web` for automation — see [Verification](#verification).

## Development workflow

The whole desktop and every app also runs over `http://localhost` — no bundler, no build step, no deps.

```bash
cd radonos
npm run dev            # serves http://127.0.0.1:4173/newtab/index.html
```

Open that URL (or `http://127.0.0.1:4173/apps/notepad/index.html`) in any Chromium browser.
`shared/platform.js` detects that `chrome.*` is missing and transparently falls back to
`localStorage` + `BroadcastChannel`, so settings, wallpaper and the virtual file system behave
identically while you iterate with hot reload.

| Script | Purpose |
| --- | --- |
| `npm run dev` | Static dev server for the whole extension (correct MIME types, no cache). |
| `npm run icons` | Regenerates `icons/icon-{16,32,48,128}.png` from the SDF renderer in `tools/make-icons.mjs`. |
| `npm run validate` | Structural checks: manifest, every referenced file, every ES import, MV3 CSP violations. |
| `npm test` | `validate` + service-worker unit suite + platform abstraction suite. |
| `npm run e2e:web` | Full desktop walkthrough in a real headless Chromium (see below). |
| `npm run e2e` | Same suite against the installed extension; auto-falls back to web mode when the browser refuses CLI loading. |
| `node tools/shots.mjs` | Visual check: captures the desktop, start menu, command bar, modal, menu, every app window and light mode into `.shots/`. |

## Architecture

```
radonos/
├── .github/workflows/pages.yml  Builds site/dist and deploys it to GitHub Pages
├── site/                    Hosted flavour: redirect.js + generated dist/ (the Pages artifact)
├── manifest.json            MV3 manifest: new tab override, action, permissions, commands
├── background.js            Service worker: install defaults, context menus, alarms,
│                            badge clock, notifications, link hand-off, message bridge
├── newtab/                  The desktop itself (chrome_url_overrides.newtab)
│   ├── index.html           Static chrome: wallpaper, desktop, window layer, taskbar, start menu, lock screen
│   ├── style.css            Desktop shell styling (windows, taskbar, menus, widgets, popovers, animations)
│   ├── boot.js              Boot sequence, global RadonOS API, deep links, session restore, error screen
│   ├── windowManager.js     Window lifecycle: open/close/minimise/maximise/drag/resize/snap/z-order/persist
│   ├── desktop.js           Icon grid, drag + auto-snap, marquee select, context menus, file drop
│   ├── taskbar.js           Running apps, start menu + search, tray popovers, notifications, about, lock
│   ├── commandBar.js        Super+Space spotlight: fuzzy search, ranking, keyboard-first execution
│   ├── controlCenter.js     Quick settings: display, sound, appearance, dock, behaviour
│   └── widgets.js           Weather, sticky note, bookmarks, performance monitor
├── apps/                    One folder per app window (html + css + app.js, loaded in an iframe)
│   ├── explorer/  notepad/  terminal/  browser/  media/  settings/
├── shared/                  The "kernel" shared by the desktop and every app
│   ├── platform.js          chrome.* abstraction with the http/dev fallback
│   ├── settings.js          Defaults, deep merge, live subscriptions
│   ├── idb.js               Promise wrapper around IndexedDB (kv + nodes stores)
│   ├── fs.js                Virtual file system: folders, files, trash, search, stats, change events
│   ├── theme.js             Accent colours, palettes, glass/brightness/dock tokens, wallpapers
│   ├── themeEngine.css      Design-system layer: glass tokens, 4 palettes, ranges, segmented, swatches
│   ├── storageManager.js    Unified persistence facade: POSIX-style VFS paths, config, dotfiles, capacity
│   ├── radonpkg.js          Package catalogue, installer and the six CLI tools it contributes
│   ├── registry.js          App catalogue (id, icon, size, category) used by desktop/start menu/terminal
│   ├── icons.js             Inline SVG icon set + RadonOS atom mark
│   ├── ui.js                Toasts, modals, prompts, confirms, context menus, formatters, app helpers
│   ├── audio.js             Synthesised OS sounds behind a master volume
│   ├── base.css / app.css   Design tokens + shared app chrome (toolbar, sidebar, lists, editor, terminal)
│   └── ...
├── assets/logo.svg          Logomark for docs
├── icons/                   Generated PNG icons
└── tools/                   Dev server, icon renderer, validators, hosted build and the four harnesses
```

### How the pieces talk

```
        ┌──────────────────────── background.js (service worker) ───────────────────────┐
        │ install defaults · context menus · alarms · badge clock · notifications      │
        └───────▲─────────────────────────▲───────────────────────────▲─────────────────┘
                │ runtime.sendMessage        │ chrome.storage          │ tabs.create
                │ (OPEN_APP/NOTIFY/…)        │ (settings, bookmarks)   │
   ┌────────────┴───────────────────────────┴─────────────────────────┴────────────────┐
   │ newtab/  desktop tab (the OS shell)                                              │
   │  windowManager  ──►  iframe per app window                                       │
   │  taskbar / desktop / widgets  ──►  shared/settings + shared/theme                │
   └────────────┬────────────────────────────────────────────────────────────────────┘
                │ same origin: shared/fs.js (IndexedDB), BroadcastChannel('radonos-fs'),
                │ parent.RadonOS API for app → shell calls
   ┌────────────▼────────────────────────────────────────────────────────────────────┐
   │ apps/*  sandboxed window documents (Files, Notepad, Terminal, Browser, Media,   │
   │         Settings) — each imports shared/* directly and can open other apps      │
   └─────────────────────────────────────────────────────────────────────────────────┘
```

- **Settings** live in `chrome.storage.local` under one `settings` key, so the service worker, the shell
  and every iframe read the same values. `shared/settings.js` deep-merges defaults, keeps a cache and
  fans out changes; `shared/theme.js` turns them into CSS custom properties.
- **Files** live in IndexedDB (`radonos` → `nodes` store). `shared/fs.js` is the only writer and emits
  change events on a `BroadcastChannel`, so saving in Notepad refreshes the Files window instantly.
- **The shell API** is exposed as `window.RadonOS` (`openApp`, `windows`, `notify`, `showAbout`, `fs`,
  `updateSettings`). Apps use the helpers in `shared/ui.js` (`openApp`, `notifyOwner`, `closeSelf`,
  `windowId`) which degrade gracefully when a page is opened standalone.
- **Window identity** is passed to each iframe as `?wid=<window-id>`, which is how `closeSelf()` closes
  the right window (used by `exit` in the terminal).

### Virtual file system schema

```js
// IndexedDB: radonos → nodes (keyPath: id), indexes: parent, name
{
  id: 'uuid', parentId: 'root' | 'trash' | 'uuid',
  name: 'Welcome.txt', kind: 'folder' | 'file',
  mime: 'text/plain', size: 566,
  content: 'text…' | Blob,          // strings for text, Blobs for binaries
  createdAt, updatedAt, origin      // origin remembers the pre-trash parent
}
```

Root folders (`Documents`, `Pictures`, `Downloads`, `Music`, `Videos`), the `Trash` folder and two
seeded documents are created — and repaired — idempotently on first boot.

### Window manager API

```js
wm.open(appId, { args, rect, title, singleton, minimized, maximized }) // → window record
wm.focus(id) · wm.minimize(id) · wm.toggleMinimize(id) · wm.maximize(id)
wm.restoreSize(id) · wm.close(id) · wm.cycle() · wm.minimizeAll() · wm.toggleShowDesktop()
wm.list() · wm.findByApp(appId) · wm.activeId · wm.subscribe(handler) · wm.workArea
```

## Adding your own app

1. Add a folder `apps/myapp/` with `index.html` (link `../../shared/base.css` and `../../shared/app.css`),
   `style.css` and `app.js` (an ES module — no inline scripts, MV3 forbids them).
2. Register it in `shared/registry.js`: `{ id: 'myapp', name: 'My App', icon: 'star', color: '#f5b544',
   src: '../apps/myapp/index.html', width, height, minWidth, minHeight, singleton, category }`.
3. Read launch arguments with `new URLSearchParams(location.search)`, and use `openApp('explorer', { path })`
   from `shared/ui.js` to hand files to another app.
4. Reload the extension. The app now appears on the desktop, in the start menu, in search, in the
   terminal (`apps`, `open myapp`) and in the taskbar automatically. `npm run site:build` picks it up
   for the hosted build too — nothing else to register.

## Verification

Everything below is runnable and was executed against this tree.

| Suite | Command | Coverage |
| --- | --- | --- |
| Structural | `npm run validate` | Every project file (59 at the time of writing); manifest parses, MV3 version, required permissions, every manifest/HTML/ES-module reference resolves, no inline handlers, `javascript:` URLs, `eval` or `new Function`. |
| Service worker | `npm run test:sw` | 18 checks against a chrome.* stub: install defaults, alarm + badge clock, four context menus, link/bookmark hand-off, `GET_TABS` filtering, `OPEN_APP`, `NOTIFY`, `SAVE_BOOKMARK` (incl. idempotency), unknown messages, command and toolbar entry points. |
| Platform layer | `npm run test:platform` | 20 checks covering both branches of `shared/platform.js`: chrome.storage round-trips and change events, tab search/query/open, runtime messaging, extension URL building; then the localStorage/BroadcastChannel fallback used by the dev server. |
| End-to-end | `npm run e2e:web` | 21 scenario groups in a real headless Chromium driving the actual UI: shell boot, Files listing, Notepad file load, Terminal commands creating real files, window drag/resize/maximize/minimize/focus/work-area clamping, start-menu search across apps/actions/files, tray calendar + notifications + theme persistence + lock screen, full VFS round-trip (create/rename/trash/restore/search), every Settings category drill-down and back, Browser embed detection, Media library + transport, window tiling (halves/quadrants/thirds + `Alt`+`Shift` shortcut), **command-bar ranking/execution/`Super`+`Space`**, **control-center palette + top dock + glass blur persistence**, **storageManager + radonpkg round-trip**, **Terminal `uname`/`vfs`/`radonpkg`**, and session restore after a reload. |
| Hosted build | `npm run site:test` | 52 checks against a running GitHub Pages build: the `/` redirect document (and its no-JS fallback), the redirect script resolving the desktop **and keeping `?app=`/hash** (executed against stubs, not just grepped), `404.html` references loading **from a deep path**, trailing-slash directory redirects, POST rejection, 404s, every document and every referenced asset (status + MIME), no root-absolute URLs outside the site prefix, no `chrome-extension://` links, no tooling/keys/maps/Worker leftovers, and `.nojekyll` present. |
| Deployed | `node tools/site-test.mjs <origin>` | The same 52 checks against a live origin, e.g. `https://goodgamescontact12345-wq.github.io/RadonOS`. |
| End-to-end | `node tools/e2e.mjs --url=<origin>` | The full 16-group UI suite in headless Chromium against a live origin: no console errors, CSP enforced (inline script injection blocked). |

The e2e harness is dependency-free: it launches your installed Chromium with the remote debugging port,
speaks CDP over Node's built-in `WebSocket`, and fails the process when any assertion or page error appears.

Not covered by automation: real `chrome.notifications` popups, the on-disk `Battery API` values, and
extension-mode launch (blocked by Chrome/Edge 137+, see the note above). Load the extension by hand to
check those.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Super` + `Space` | Open the command bar (spotlight) |
| `Ctrl` / `Cmd` + `K` | Same command bar (works where the OS owns `Win`+`Space`) |
| `>` on the desktop | Open the command bar, shell-style |
| `↑` `↓` / `Tab` / `↵` / `Esc` | Move, cycle, run, close in the command bar |
| `Alt` + `Space` | Open the start menu / search |
| `Alt` + `W` | Close the focused window |
| `Alt` + `M` | Minimise the focused window |
| `Alt` + `Tab` | Cycle open windows |
| `Alt` + `Shift` + `←` / `→` | Tile the focused window to the left / right half |
| `Alt` + `Shift` + `1`–`4` | Tile to a quadrant (top-left → bottom-right) |
| `Alt` + `Shift` + `5` | Centre the focused window |
| `Alt` + `Shift` + `T` | Cycle through tiling layouts |
| `Alt` + `Shift` + `↑` / `↓` | Maximise / restore the focused window |
| Double-click title bar | Maximise / restore |
| Drag to screen edge | Snap left/right, drag to top to maximise |
| `Ctrl` + `S` / `Ctrl` + `O` / `Ctrl` + `N` | Notepad save / open / new |
| `Ctrl` + `L` / `Ctrl` + `C` | Terminal clear / cancel line |
| `Ctrl` + `L` / `Ctrl` + `D` / `Ctrl` + `T` | Browser focus address / bookmark / new window |
| `Tab` | Terminal path + command completion |
| `Delete` | Move the selected Files items to trash |
| `Alt` + `Shift` + `R` | Open RadonOS (extension command) |

## Limitations and roadmap

- Sites that send `X-Frame-Options`/CSP frame restrictions (Google, YouTube, GitHub, …) cannot be
  embedded in a window; RadonOS detects the common ones up front and offers a real tab instead.
- The virtual file system is per browser profile and is not synced anywhere. Export/import in
  Settings → Storage covers settings, folders and text files (binaries stay local).
- `performance.memory` is Chromium-only (and may report coarse values); the widgets degrade gracefully.
- Roadmap ideas: image viewer + PDF app, drag files between Files windows, window tiling shortcuts,
  PWA-style external app windows, a WebDAV/IndexedDB sync bridge, and an app store fed by the registry.
