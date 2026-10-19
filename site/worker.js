/**
 * Hosted build entrypoint.
 *
 * RadonOS is a pure static app: the desktop, every app window and the shared
 * kernel are plain ES modules. All state (settings, the virtual file system,
 * wallpapers) lives in the visitor's own browser via localStorage +
 * IndexedDB — nothing is stored or read on the server.
 *
 * Cloudflare's static-assets layer serves any file that exists, so this Worker
 * only handles what the assets layer cannot:
 *   1. `/` redirects to the canonical desktop URL `/newtab/`, keeping the query
 *      string so `/?app=terminal` and similar deep links still work;
 *   2. unknown HTML navigations get the desktop instead of a bare 404;
 *   3. everything else non-GET is rejected.
 *
 * The trailing-slash form is canonical because the assets layer itself
 * redirects `/newtab/index.html` to `/newtab/`, which keeps the document's
 * relative asset paths identical to the extension build.
 */

const DESKTOP = '/newtab/';

function wantsHtml(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  if (request.headers.get('sec-fetch-mode') === 'navigate') return true;
  return (request.headers.get('accept') || '').includes('text/html');
}

/** Redirect to the desktop while preserving the query (deep links). */
function toDesktop(url) {
  const target = new URL(DESKTOP, url);
  target.search = url.search;
  return new Response(null, {
    status: 302,
    headers: {
      location: target.toString(),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed\n', {
        status: 405,
        headers: {
          allow: 'GET, HEAD',
          'content-type': 'text/plain; charset=utf-8',
        },
      });
    }

    if (url.pathname === '/' || url.pathname === '') {
      return toDesktop(url);
    }

    const response = await env.ASSETS.fetch(request);
    if (response.status === 404 && wantsHtml(request)) {
      return toDesktop(url);
    }

    return response;
  },
};
