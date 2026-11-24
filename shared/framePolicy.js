/**
 * Frame-blocking headers, the hosts that send them, and the extension-side rule
 * that stops them from ever arriving.
 *
 * A page that answers with `X-Frame-Options` or a CSP `frame-ancestors`
 * directive is refused by the browser before any RadonOS code can react, so the
 * only way to draw it inside the desktop is for those headers not to be there.
 * The hosted build cannot do that: it is only files on a static host. The
 * extension can, because `declarativeNetRequest` rewrites responses inside the
 * browser.
 *
 * The rule is scoped by resource type and by host:
 *   - `resourceTypes: ['sub_frame']` — top-level browsing keeps its policy, so
 *     a page opened in a real tab is unaffected;
 *   - `requestDomains: EMBED_BLOCKED` — only the hosts the browser already
 *     treats as frame-blockers are touched. `requestDomains` matches subdomains
 *     too, which also covers a listed site navigating inside its own frame
 *     (a click on a link is initiated by that page, not by RadonOS).
 *
 * Dropping `Content-Security-Policy` also drops that page's own script policy
 * inside the frame, which is the price of embedding a site that sets
 * `frame-ancestors`. The frame is sandboxed without `allow-top-navigation`, so
 * the page still cannot navigate the desktop away.
 */

/** Hosts known to send frame-blocking headers. Matched with their subdomains. */
export const EMBED_BLOCKED = new Set([
  'google.com', 'www.google.com', 'youtube.com', 'www.youtube.com', 'github.com',
  'twitter.com', 'x.com', 'reddit.com', 'www.reddit.com', 'instagram.com',
  'facebook.com', 'www.facebook.com', 'netflix.com', 'linkedin.com', 'amazon.com',
  'stackoverflow.com', 'tiktok.com', 'discord.com', 'whatsapp.com', 'openai.com',
  'chat.openai.com', 'mail.google.com', 'drive.google.com', 'figma.com',
  'open.spotify.com', 'spotify.com', 'notion.so', 'medium.com', 'duckduckgo.com',
]);

/** Dynamic rule id, kept stable so a reinstall replaces rather than adds. */
export const RULE_ID = 4241;

/** Headers that make a browser refuse to frame a page. */
export const FRAME_HEADERS = ['X-Frame-Options', 'Frame-Options', 'Content-Security-Policy'];

/** The dynamic rule that drops them from frames of the listed hosts. */
export function frameRule() {
  return {
    id: RULE_ID,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      responseHeaders: FRAME_HEADERS.map((header) => ({ header, operation: 'remove' })),
    },
    condition: {
      resourceTypes: ['sub_frame'],
      requestDomains: [...new Set(EMBED_BLOCKED)],
    },
  };
}

/**
 * Install (or refresh) the rule. Never throws: `{ ok: false }` means this build
 * or browser cannot unframe pages, and the caller keeps using the linked
 * window instead.
 */
export async function installFrameRules({ dnr } = {}) {
  const api = dnr || globalThis.chrome?.declarativeNetRequest;
  if (!api?.updateDynamicRules) return { ok: false, reason: 'unsupported' };
  try {
    const existing = (await api.getDynamicRules?.()) || [];
    const ours = existing.filter((rule) => rule.id === RULE_ID).map((rule) => rule.id);
    await api.updateDynamicRules({
      removeRuleIds: [...new Set([...ours, RULE_ID])],
      addRules: [frameRule()],
    });
    return { ok: true, id: RULE_ID };
  } catch (error) {
    return { ok: false, reason: String(error?.message || error) };
  }
}

/** `installFrameRules`, but a worker restart does not rewrite the rule. */
export async function ensureFrameRules(options = {}) {
  const api = options.dnr || globalThis.chrome?.declarativeNetRequest;
  if (!api?.getDynamicRules) return installFrameRules(options);
  try {
    const rules = await api.getDynamicRules();
    if (rules.some((rule) => rule.id === RULE_ID)) return { ok: true, id: RULE_ID, kept: true };
  } catch {
    /* fall through and install */
  }
  return installFrameRules(options);
}
