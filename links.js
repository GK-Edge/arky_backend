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

/** Lowercase and strip accents, so "Γεια" and "γεια" read the same. */
const fold = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * The only hosts ARKY may link to outside the site. A model can be talked into writing any URL, and a link rendered
 * inside GK Edge's own chat panel carries GK Edge's credibility with it; an address nobody vetted must not get that.
 */
export const ALLOWED_HOSTS = ['gk-edge.com', 'www.gk-edge.com', 'linkedin.com', 'www.linkedin.com'];

/** The URL in the form it should be rendered, or null when nothing should link to it. */
export function resolveExternal(raw) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  return ALLOWED_HOSTS.includes(url.hostname.toLowerCase()) ? String(raw) : null;
}

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
const EXTERNAL_LINK = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;
const BARE_URL = /(^|[\s(“"'])(https?:\/\/[^\s)<>"']+)/g;
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

  safe = safe.replace(EXTERNAL_LINK, (whole, label, url) => (resolveExternal(url) ? whole : label));

  safe = safe.replace(BARE_URL, (whole, lead, url) => {
    const trimmed = url.replace(/[.,;:!?]+$/, '');
    const trailing = url.slice(trimmed.length);
    return resolveExternal(trimmed) ? whole : `${lead}${trimmed.replace(/^https?:\/\//, '')}${trailing}`;
  });

  safe = safe.replace(BARE_PATH, (whole, lead, path) => {
    const target = resolvePath(path);
    return target ? `${lead}${target}` : `${lead}${path.replace(/^\//, '')}`;
  });

  return safe;
}


/** Greetings, thanks and goodbyes: an answer to one of these needs words, not a call to action. */
const SMALL_TALK = /^(?:hi|hey|hello|yo|sup|good (?:morning|afternoon|evening)|thanks?|thank you|cheers|ok(?:ay)?|bye|goodbye|γεια|γεια σου|γεια σας|καλημερα|καλησπερα|ευχαριστω|ευχαριστώ|αντιο|τεστ|test)[\s!.,]*$/iu;

/** True when the visitor has said hello rather than asked something. */
export function isSmallTalk(message) {
  return SMALL_TALK.test(fold(String(message ?? '')).trim() || String(message ?? '').trim());
}

/**
 * Keeps at most `max` links in an answer and unlinks the rest, leaving their words. Models reach for a call to action at
 * the end of every reply; a visitor who asked what a phase is called does not need to be sold to twice.
 */
export function capLinks(text, max) {
  if (!text) return text;
  let kept = 0;
  const seen = new Set();
  return String(text).replace(/\[([^\]\n]+)\]\((\/[^)\s]*)\)/g, (whole, label, path) => {
    if (kept >= max || seen.has(path)) return label;
    seen.add(path);
    kept += 1;
    return whole;
  });
}

/**
 * The same check applied to a stream, where a link can be split across two pieces. Text is released only up to a point
 * where nothing half-written is left behind: an unclosed `[`, or a trailing fragment that may still grow into a path.
 */
export function createLinkSanitizer({ maxLinks = Infinity } = {}) {
  let pending = '';
  let used = 0;
  const seen = new Set();

  /** Applies the budget to one released piece, counting what it lets through. */
  const budget = (text) => text.replace(/\[([^\]\n]+)\]\((\/[^)\s]*)\)/g, (whole, label, path) => {
    if (used >= maxLinks || seen.has(path)) return label;
    seen.add(path);
    used += 1;
    return whole;
  });

  const safeCut = (text) => {
    // Everything up to the end of the last finished link is settled; only what follows can still grow.
    let settled = 0;
    for (const match of text.matchAll(/\[[^\]\n]*\]\([^)\s]*\)/g)) settled = match.index + match[0].length;

    const open = text.lastIndexOf('[');
    if (open >= settled) return open; // a link has started and not finished

    const tail = text.slice(settled);
    const trailing = tail.match(/(?:\/|\[)[^\s]*$/);
    if (trailing) return settled + tail.length - trailing[0].length; // a path may still be arriving
    return text.length;
  };

  return {
    /** Returns the part of the answer that is safe to send now. */
    push(chunk) {
      pending += chunk ?? '';
      const cut = safeCut(pending);
      const ready = pending.slice(0, cut);
      pending = pending.slice(cut);
      return budget(sanitizeLinks(ready));
    },
    /** Returns whatever was being held back, once the answer is complete. */
    flush() {
      const rest = budget(sanitizeLinks(pending));
      pending = '';
      return rest;
    },
  };
}
