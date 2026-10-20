/**
 * Entry redirect for the hosted build.
 *
 * `index.html` and `404.html` are the only two documents GitHub Pages cannot
 * answer with an asset, so both load this script. It is external because the
 * meta CSP forbids inline scripts.
 *
 * The desktop is resolved relative to this file's own URL rather than to
 * `location`, which matters twice over:
 *   - on a project page the site lives at `/RadonOS/`, not at the origin root;
 *   - on the 404 page the current path can be any depth (`/RadonOS/a/b/c`).
 *
 * The query string and hash are carried across so `?app=terminal` and similar
 * deep links open the app they name.
 */
(() => {
  const self = document.currentScript;
  const root = new URL('./', self ? self.src : location.href);
  const desktop = new URL('newtab/', root);
  desktop.search = location.search;
  desktop.hash = location.hash;
  location.replace(desktop.href);
})();
