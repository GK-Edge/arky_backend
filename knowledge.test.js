import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createKnowledgeBase, fold, parseSections, tokenize } from './knowledge.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const realMarkdown = fs.readFileSync(path.join(here, 'knowledgebase.md'), 'utf8');

/** Forces retrieval instead of whole-base mode, so ranking can be tested against the real content. */
const retrieving = (options = {}) => createKnowledgeBase(realMarkdown, { wholeBaseLimit: 10, budget: 1800, ...options });

const headingsFor = (base, query) => base.context(query).headings.join(' | ');

test('folding puts accented and unaccented Greek on the same footing', () => {
  assert.equal(fold('Υπηρεσίες'), 'υπηρεσιεσ');
  assert.equal(fold('υπηρεσιες'), 'υπηρεσιεσ');
  assert.equal(fold('Café — Prix!'), 'cafe prix');
});

test('tokenizing drops the words that carry no signal, in both languages', () => {
  assert.deepEqual(tokenize('how do you work with us'), ['work']);
  assert.deepEqual(tokenize('τι κανετε για εμενα'), ['κανετε']);
});

test('tokenizing keeps two-letter terms of substance, such as AI', () => {
  assert.ok(tokenize('what can ai do').includes('ai'));
});

test('tokenizing reduces a word to the form its relatives share', () => {
  const [agencies] = tokenize('agencies');
  assert.equal(agencies, tokenize('agency')[0]);
  const [services] = tokenize('υπηρεσιες');
  assert.equal(services, tokenize('υπηρεσιων')[0]);
});

test('a section announces the headings it sits under', () => {
  const sections = parseSections('# Company\n\ntop\n\n## How We Work\n\nmid\n\n### Phase 1\n\nWe analyse the business.');
  const phase = sections.find((s) => s.title === 'Phase 1');
  assert.equal(phase.heading, 'Company > How We Work > Phase 1');
  assert.equal(phase.content, 'We analyse the business.');
});

test('a question about the process reaches the phases, not the opening pitch', () => {
  const headings = headingsFor(retrieving(), 'how do you work, what are the phases of a project');
  assert.match(headings, /Phase 1/);
  assert.doesNotMatch(headings.split(' | ')[0], /The Problem We Solve/);
});

test('a question about the founders reaches the team', () => {
  assert.match(headingsFor(retrieving(), 'who founded the company'), /Team Members/);
});

test('a question about a vertical reaches that vertical', () => {
  assert.match(headingsFor(retrieving(), 'do you work with real estate agencies'), /Real Estate/);
});

test('a common word does not drag in every section', () => {
  const ranked = retrieving().rank('business');
  assert.ok(ranked.length < parseSections(realMarkdown).length, 'a word this common should not match everything');
});

test('a Greek question reaches the English section that holds its answer', () => {
  const base = createKnowledgeBase(
    ['# Greek Glossary', '', '| Greek | English |', '| --- | --- |', '| υπηρεσίες | services |', '',
     '# Services', '', 'We build custom AI services.', '', '# Careers', '', 'We hire engineers.'].join('\n'),
    { wholeBaseLimit: 10, budget: 400 },
  );
  const headings = base.context('ποιες υπηρεσιες προσφερετε').headings.join(' | ');
  assert.match(headings, /Services/);
  assert.doesNotMatch(headings, /Careers/);
});

test('the glossary translates a question but is never returned as the answer', () => {
  const headings = headingsFor(retrieving(), 'πως μπορω να επικοινωνησω μαζι σας');
  assert.doesNotMatch(headings, /Glossary/);
  assert.match(headings, /Contact|Email/);
});

test('a Greek question about cost reaches what the site says about pricing', () => {
  // The glossary maps κόστος to "pricing, cost", which is what carries a Greek question to the English answer.
  const { text } = retrieving().context('ποσο κοστιζει');
  assert.match(text, /pricing|price/i);
});

test('a long reference table does not outrank the short section that answers the question', () => {
  const headings = headingsFor(retrieving(), 'what are the five phases of how you work');
  assert.match(headings, /Phase 1/);
});

test('a question with nothing but common words still returns something to answer from', () => {
  const { text, headings } = retrieving().context('hello there');
  assert.ok(headings.length > 0);
  assert.ok(text.length > 0);
});

test('retrieval stays inside its budget', () => {
  const { text } = retrieving({ budget: 900 }).context('ai automation for e-commerce customer support');
  assert.ok(text.length <= 900 + 1400, `context was ${text.length} characters`);
});

test('a knowledge base this small is sent whole, so nothing can be missed', () => {
  const base = createKnowledgeBase(realMarkdown);
  const { whole, text } = base.context('anything at all');
  assert.equal(whole, true);
  assert.equal(base.describe().mode, 'whole-base');
  assert.match(text, /Team Members/);
  assert.match(text, /Phase 5/);
});

test('an empty knowledge base yields empty context rather than throwing', () => {
  const base = createKnowledgeBase('');
  assert.deepEqual(base.context('hello'), { text: '', headings: [], whole: false });
  assert.equal(base.describe().sections, 0);
});
