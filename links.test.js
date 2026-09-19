import test from 'node:test';
import assert from 'node:assert/strict';
import { capLinks, createLinkSanitizer, isSmallTalk, resolveExternal, resolvePath, sanitizeLinks } from './links.js';

test('a page that exists is linked as written', () => {
  assert.equal(sanitizeLinks('See [Contact](/contact).'), 'See [Contact](/contact).');
  assert.equal(sanitizeLinks('Start at [Home](/).'), 'Start at [Home](/).');
});

test('a retired URL keeps its words and loses its link, rather than opening a different page', () => {
  // A link labelled "Services" that opens the demo form is the bug this guard exists to prevent.
  assert.equal(sanitizeLinks('See our [Services](/services).'), 'See our Services.');
  assert.equal(sanitizeLinks('[Pricing](/pricing)'), 'Pricing');
  assert.equal(sanitizeLinks('[About us](/about-us)'), 'About us');
});

test('a path the site has never had keeps its words and loses its link', () => {
  assert.equal(sanitizeLinks('Try [our blog posts](/blog/ai-2026) for more.'), 'Try our blog posts for more.');
  assert.equal(sanitizeLinks('Book at [this page](/schedule-a-call).'), 'Book at this page.');
});

test('a Greek answer keeps its /el prefix', () => {
  assert.equal(sanitizeLinks('[Επικοινωνία](/el/contact)'), '[Επικοινωνία](/el/contact)');
  assert.equal(sanitizeLinks('[Υπηρεσίες](/el/services)'), 'Υπηρεσίες');
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
  assert.equal(sanitizeLinks('Visit /services to learn more.'), 'Visit services to learn more.');
  assert.equal(sanitizeLinks('Visit /nowhere-real to learn more.'), 'Visit nowhere-real to learn more.');
  assert.equal(sanitizeLinks('Visit /contact.'), 'Visit /contact.');
});

test('a link split across two pieces of a stream is still checked', () => {
  const sanitizer = createLinkSanitizer();
  const out = [];
  out.push(sanitizer.push('You can see our [Serv'));
  out.push(sanitizer.push('ices](/services) page.'));
  out.push(sanitizer.flush());
  assert.equal(out.join(''), 'You can see our Services page.');
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
  assert.equal(out.join(''), 'Go to services now');
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

test('a greeting gets no call to action, however it is padded', () => {
  for (const greeting of ['hello', 'Γεια σας', 'thanks!', 'thanks a lot', 'Ευχαριστώ πολύ', 'ok great', 'hi there', 'καλημέρα σας']) {
    assert.equal(isSmallTalk(greeting), true, greeting);
  }
  for (const question of ['what do you build?', 'thanks, how much does it cost', 'hello I need an AI system', 'ευχαριστώ, πόσο κοστίζει']) {
    assert.equal(isSmallTalk(question), false, question);
  }
  assert.equal(capLinks('Hi there. [Contact](/contact) [Team](/team)', 0), 'Hi there. Contact Team');
});

test('an answer keeps the links it needs and drops the sales pitch after them', () => {
  const text = 'Phase 1 is analysis. [Request a Demo](/request-demo) or [Contact](/contact) or [Team](/team).';
  assert.equal(capLinks(text, 2), 'Phase 1 is analysis. [Request a Demo](/request-demo) or [Contact](/contact) or Team.');
});

test('the same page is never linked twice in one answer', () => {
  assert.equal(capLinks('[Contact](/contact) and again [Contact](/contact)', 2), '[Contact](/contact) and again Contact');
});

test('a streamed answer obeys the same budget across chunks', () => {
  const sanitizer = createLinkSanitizer({ maxLinks: 1 });
  const out = [
    sanitizer.push('See [Contact](/contact) '),
    sanitizer.push('and [Request a Demo](/request-demo).'),
    sanitizer.flush(),
  ];
  assert.equal(out.join(''), 'See [Contact](/contact) and Request a Demo.');
});

test('a link to GK Edge or LinkedIn survives, any other site does not', () => {
  const linkedin = '[Manos on LinkedIn](https://www.linkedin.com/in/manos-koulouris/)';
  assert.equal(sanitizeLinks(linkedin), linkedin);
  assert.equal(sanitizeLinks('[our site](https://gk-edge.com/team)'), '[our site](https://gk-edge.com/team)');
  assert.equal(sanitizeLinks('[claim your prize](https://totally-legit.example/login)'), 'claim your prize');
});

test('a bare address to somewhere else keeps its words but stops being clickable', () => {
  assert.equal(sanitizeLinks('See https://evil.example/login now.'), 'See evil.example/login now.');
  const ours = 'See https://www.linkedin.com/company/gk-edge/ for updates.';
  assert.equal(sanitizeLinks(ours), ours);
});

test('a link that is not even a web address is dropped', () => {
  assert.equal(sanitizeLinks('[click](javascript:alert(1))'), '[click](javascript:alert(1))');
  assert.equal(resolveExternal('javascript:alert(1)'), null);
  assert.equal(resolveExternal('https://gk-edge.com.evil.example/'), null);
});

test('an email address is never turned into a link to a page', () => {
  assert.equal(sanitizeLinks('Email [info@gk-edge.com](/contact) or visit [Contact](/contact).'),
    'Email info@gk-edge.com or visit [Contact](/contact).');
  assert.equal(sanitizeLinks('[careers@gk-edge.com](/careers)'), 'careers@gk-edge.com');
});
