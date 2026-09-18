/**
 * Keeps ARKY's answers pointing at pages that exist.
 *
 * The site is a single-page app: an unknown path does not 404 at the server, it renders the site's own "page not found"
 * screen, which is a worse dead end than a broken link because it looks like the site is at fault. A model that has read
 * a knowledge base mentioning retired URLs will sooner or later offer one, so every link it writes is checked here
 * rather than trusted: a path the site serves passes, and anything else loses its link and keeps its words.
 *
 * It deliberately does not send an unknown path to some nearby page. The model chose the words of the link, and a label
 * reading "Our Services" that lands on the demo form is a worse answer than the same words with no link at all: the
 * visitor asked for one thing and arrived somewhere else. Redirecting retired URLs is the web server's job, for people
 * who type them; it is not a way to rescue a link the model should not have written.
 */

/** Every path the site actually serves. Mirrors the routes in App.tsx. */
export const SITE_PATHS = [
  '/',
  '/contact',
  '/team',
  '/careers',
  '/request-demo',
  '/privacy',
  '/terms',
  '/extension-privacy',
];

const known = new Set(SITE_PATHS);

/**
 * The path in the form the site serves it, or null if the site has no such page. Handles the `/el` prefix, a trailing
 * slash, and any query or hash the model appended.
 */
export function resolvePath(raw) {
  const [pathOnly] = String(raw).split(/[?#]/);
  const greek = /^\/el(\/|$)/.test(pathOnly);
  let base = greek ? pathOnly.replace(/^\/el/, '') || '/' : pathOnly;
  base = base.toLowerCase();
  if (base.length > 1) base = base.replace(/\/+$/, '');
  if (!base.startsWith('/')) return null;

  if (!known.has(base)) return null;
  if (!greek) return base;
  return base === '/' ? '/el' : `/el${base}`;
}

const MARKDOWN_LINK = /\[([^\]\n]+)\]\((\/[^)\s]*)\)/g;
// A bare path in the prose, which the site renders as a link of its own. Not preceded by a word character or a slash,
// so "info@gk-edge.com" and "https://example.com/path" are left alone.
const BARE_PATH = /(^|[\s(“"'])(\/[a-z][a-z0-9-]*(?:\/[a-z0-9-]+)*)\/?(?=$|[\s),.;:!?”"'])/gim;

/** Unlinks every site path in a piece of an answer that the site does not serve. External links are left as written. */
export function sanitizeLinks(text) {
  if (!text) return text;

  let safe = String(text).replace(MARKDOWN_LINK, (whole, label, path) => {
    const target = resolvePath(path);
    return target ? `[${label}](${target})` : label;
  });

  safe = safe.replace(BARE_PATH, (whole, lead, path) => {
    const target = resolvePath(path);
    return target ? `${lead}${target}` : `${lead}${path.replace(/^\//, '')}`;
  });

  return safe;
}

/**
 * The same check applied to a stream, where a link can be split across two pieces. Text is released only up to a point
 * where nothing half-written is left behind: an unclosed `[`, or a trailing fragment that may still grow into a path.
 */
export function createLinkSanitizer() {
  let pending = '';

  const safeCut = (text) => {
    const open = text.lastIndexOf('[');
    if (open !== -1 && !/\]\([^)]*\)/.test(text.slice(open))) return open;
    const trailing = text.match(/(?:\/|\[)[^\s]*$/);
    if (trailing) return text.length - trailing[0].length;
    return text.length;
  };

  return {
    /** Returns the part of the answer that is safe to send now. */
    push(chunk) {
      pending += chunk ?? '';
      const cut = safeCut(pending);
      const ready = pending.slice(0, cut);
      pending = pending.slice(cut);
      return sanitizeLinks(ready);
    },
    /** Returns whatever was being held back, once the answer is complete. */
    flush() {
      const rest = sanitizeLinks(pending);
      pending = '';
      return rest;
    },
  };
}
