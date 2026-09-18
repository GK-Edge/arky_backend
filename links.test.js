import test from 'node:test';
import assert from 'node:assert/strict';
import { createLinkSanitizer, resolvePath, sanitizeLinks } from './links.js';

test('a page that exists is linked as written', () => {
  assert.equal(sanitizeLinks('See [Contact](/contact).'), 'See [Contact](/contact).');
  assert.equal(sanitizeLinks('Start at [Home](/).'), 'Start at [Home](/).');
});

test('a retired URL is sent to the page that replaced it', () => {
  assert.equal(sanitizeLinks('See our [Services](/services).'), 'See our [Services](/request-demo).');
  assert.equal(sanitizeLinks('[Pricing](/pricing)'), '[Pricing](/request-demo)');
  assert.equal(sanitizeLinks('[About us](/about-us)'), '[About us](/team)');
});

test('a path the site has never had keeps its words and loses its link', () => {
  assert.equal(sanitizeLinks('Try [our blog posts](/blog/ai-2026) for more.'), 'Try our blog posts for more.');
  assert.equal(sanitizeLinks('Book at [this page](/schedule-a-call).'), 'Book at this page.');
});

test('a Greek answer keeps its /el prefix', () => {
  assert.equal(sanitizeLinks('[Επικοινωνία](/el/contact)'), '[Επικοινωνία](/el/contact)');
  assert.equal(sanitizeLinks('[Υπηρεσίες](/el/services)'), '[Υπηρεσίες](/el/request-demo)');
  assert.equal(sanitizeLinks('[Αρχική](/el)'), '[Αρχική](/el)');
});

test('a trailing slash, a query or a hash does not make a real page look unknown', () => {
  assert.equal(resolvePath('/contact/'), '/contact');
  assert.equal(resolvePath('/team?ref=arky'), '/team');
  assert.equal(resolvePath('/careers#roles'), '/careers');
  assert.equal(resolvePath('/Contact'), '/contact');
});

test('an external link is left exactly as the model wrote it', () => {
  const text = 'Email info@gk-edge.com or see https://www.linkedin.com/company/gk-edge/ for updates.';
  assert.equal(sanitizeLinks(text), text);
  assert.equal(sanitizeLinks('[LinkedIn](https://www.linkedin.com/in/manos-koulouris/)'),
    '[LinkedIn](https://www.linkedin.com/in/manos-koulouris/)');
});

test('a bare path in the prose is corrected too, because the site turns it into a link', () => {
  assert.equal(sanitizeLinks('Visit /services to learn more.'), 'Visit /request-demo to learn more.');
  assert.equal(sanitizeLinks('Visit /nowhere-real to learn more.'), 'Visit nowhere-real to learn more.');
  assert.equal(sanitizeLinks('Visit /contact.'), 'Visit /contact.');
});

test('a link split across two pieces of a stream is still checked', () => {
  const sanitizer = createLinkSanitizer();
  const out = [];
  out.push(sanitizer.push('You can see our [Serv'));
  out.push(sanitizer.push('ices](/services) page.'));
  out.push(sanitizer.flush());
  assert.equal(out.join(''), 'You can see our [Services](/request-demo) page.');
});

test('a stream releases text as it goes rather than holding the whole answer', () => {
  const sanitizer = createLinkSanitizer();
  const first = sanitizer.push('We build custom AI systems for your operations. ');
  assert.equal(first, 'We build custom AI systems for your operations. ');
});

test('a path split across pieces is not released half-written', () => {
  const sanitizer = createLinkSanitizer();
  const out = [];
  out.push(sanitizer.push('Go to /serv'));
  out.push(sanitizer.push('ices now'));
  out.push(sanitizer.flush());
  assert.equal(out.join(''), 'Go to /request-demo now');
});

test('nothing is lost when an answer ends mid-link', () => {
  const sanitizer = createLinkSanitizer();
  const out = [sanitizer.push('See [Contact'), sanitizer.flush()];
  assert.equal(out.join(''), 'See [Contact');
});

test('every path the knowledge base names is a page that exists', async () => {
  const fs = await import('fs');
  const path = await import('path');
  const { fileURLToPath } = await import('url');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const markdown = fs.readFileSync(path.join(here, 'knowledgebase.md'), 'utf8');

  const mentioned = new Set([
    ...[...markdown.matchAll(/\]\((\/[^)\s]*)\)/g)].map((m) => m[1]),
    ...[...markdown.matchAll(/`(\/[a-z][a-z0-9/-]*)`/gi)].map((m) => m[1]),
  ]);

  const dead = [...mentioned].filter((p) => resolvePath(p) !== p);
  assert.deepEqual(dead, [], `the knowledge base names paths that are not live pages: ${dead.join(', ')}`);
});
