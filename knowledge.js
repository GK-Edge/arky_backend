/**
 * The knowledge ARKY answers from.
 *
 * `knowledgebase.md` is parsed once into sections, one per markdown heading, each carrying the trail of headings above it
 * so an excerpt still says where it came from. A visitor question then picks the sections worth sending.
 *
 * Two things this has to get right that the first version did not:
 *
 * 1. Greek. The site is bilingual, so questions arrive in Greek. Text is folded to unaccented lowercase across scripts,
 *    which puts "υπηρεσίες" and "υπηρεσιες" on the same footing, and the glossary section of the knowledge base carries
 *    the Greek terms that bridge to the English content.
 * 2. Common words. Matching on raw substrings made every section look relevant, because "the" and "you" appear in all of
 *    them. Words are matched whole, stop words are dropped, and each word is weighted by how rare it is, so "estate"
 *    counts and "work" barely does.
 *
 * The knowledge base is currently small enough to send in full, which beats any retrieval: perfect recall, no chance of
 * dropping the one section that held the answer. Retrieval takes over automatically once the file outgrows the budget.
 */

import fs from 'fs';
import path from 'path';

/**
 * Send the whole knowledge base while it fits in this many characters — roughly 12k tokens, which the model reads in a
 * fraction of the time it takes to write an answer, and which costs a fraction of a cent. Perfect recall is worth that:
 * no retrieval can be trusted to pick the one section that held the answer. Past this size, retrieval takes over.
 */
export const WHOLE_BASE_LIMIT = 45000;

/** When retrieving, stop adding sections past this many characters. */
export const RETRIEVAL_BUDGET = 8000;

const EN_STOPWORDS = `a about after all also am an and any are as at be because been before being but by can cant could
did do does doing done dont each even every for from get give go going had has have having he her here hers him his how
i if in into is it its just like make may me might more most much my need no not now of off on once one only or other
our out over own please said same say see she should so some such than that the their them then there these they this
those through to too under until up us very was way we well were what when where which while who why will with would
you your yours`.split(/\s+/);

const EL_STOPWORDS = `αλλα αν απο αυτα αυτες αυτη αυτο αυτοι αυτος αυτους αυτων για δεν δηλαδη εαν ειμαι ειμαστε ειναι
εισαι ειστε εκει εκεινα εκεινες εκεινη εκεινο εκεινοι εκεινος ελα εμεις εμενα ενα εναν ενας εξω επι εσεις εσενα ετσι
ευχαριστω εχει εχεις εχετε εχουμε εχουν η θα καθε και κατα κατι κατω μας με μερικα μετα μη μην μια μονο μου να ναι ο οι
ολα ολες ολη ολο ολοι ολος οπου οπως οσο οταν οτι ουτε παλι παρα περι ποια ποιες ποιο ποιοι ποιος πολυ ποτε που προς πως
σαν σας σε σου στη στην στις στο στον στου στους στων συν ταδε τη την της τι τις το τον του τους των υπο ως`.split(/\s+/);

/**
 * Lowercase, drop accents, and keep only letters, digits and spaces — in any script, so Greek survives. Final sigma is
 * folded to plain sigma so "υπηρεσίες" and "υπηρεσιες" match.
 */
export function fold(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ς/g, 'σ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Stop words folded the same way a question is, so "σας" and its folded form "σασ" are both dropped. */
const STOPWORDS = new Set([...EN_STOPWORDS, ...EL_STOPWORDS].map((word) => fold(word)));

/**
 * Trim the endings that separate a word from the same word in another form, so "agencies" meets "agency" and
 * "υπηρεσιων" meets "υπηρεσια". Deliberately shallow: over-trimming collides unrelated words.
 */
const SUFFIXES = [
  // Greek case and number endings
  { end: 'ιεσ', min: 6, replace: '' }, { end: 'ιων', min: 6, replace: '' }, { end: 'ουσ', min: 6, replace: '' },
  { end: 'εων', min: 6, replace: '' }, { end: 'ησ', min: 6, replace: '' }, { end: 'ασ', min: 6, replace: '' },
  { end: 'οσ', min: 6, replace: '' }, { end: 'ου', min: 6, replace: '' }, { end: 'ων', min: 6, replace: '' },
  { end: 'εσ', min: 6, replace: '' },
  // English inflections. "ies" and "y" both land on "i", so "agencies" meets "agency".
  { end: 'ing', min: 6, replace: '' }, { end: 'ies', min: 6, replace: 'i' }, { end: 'ed', min: 5, replace: '' },
  { end: 'er', min: 6, replace: '' }, { end: 'es', min: 5, replace: '' }, { end: 'e', min: 6, replace: '' },
  { end: 'y', min: 5, replace: 'i' }, { end: 's', min: 4, replace: '' },
];

export function stem(token) {
  let word = token;
  for (let pass = 0; pass < 3; pass += 1) {
    const rule = SUFFIXES.find((s) => word.length >= s.min && word.endsWith(s.end));
    if (!rule) break;
    word = word.slice(0, -rule.end.length) + rule.replace;
  }
  return word;
}

/** The words worth matching on: whole words, two letters or more, stop words removed, reduced to their stem. */
export function tokenize(value) {
  return fold(value)
    .split(' ')
    .filter((word) => word.length >= 2 && !STOPWORDS.has(word))
    .map(stem)
    .filter(Boolean);
}

function countTokens(tokens) {
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

/**
 * Split markdown into one section per heading. `trail` is the headings above it, so a "Phase 1" section still announces
 * itself as part of "HOW WE WORK".
 */
export function parseSections(markdown) {
  if (!markdown || !markdown.trim()) return [];
  // HTML comments are notes to whoever edits the file. The model must never read them as things it knows.
  markdown = markdown.replace(/<!--[\s\S]*?-->/g, '');

  const sections = [];
  const ancestors = [];
  let current = { title: 'Overview', level: 1, trail: [], lines: [] };

  const flush = () => {
    const content = current.lines.join('\n').trim();
    if (!content) return;
    const heading = [...current.trail, current.title].join(' > ');
    sections.push({
      title: current.title,
      trail: current.trail,
      heading,
      level: current.level,
      content,
      titleTokens: new Set(tokenize(heading)),
      contentCounts: countTokens(tokenize(content)),
    });
  };

  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (!heading) { current.lines.push(line); continue; }
    flush();
    const level = heading[1].length;
    while (ancestors.length && ancestors[ancestors.length - 1].level >= level) ancestors.pop();
    current = { title: heading[2].trim(), level, trail: ancestors.map((a) => a.title), lines: [] };
    ancestors.push({ title: current.title, level });
  }
  flush();

  return sections;
}

/** How rare each word is across the sections. A word in every section tells us nothing, so it scores near zero. */
function inverseFrequencies(sections) {
  const documentCount = new Map();
  for (const section of sections) {
    const seen = new Set([...section.titleTokens, ...section.contentCounts.keys()]);
    for (const token of seen) documentCount.set(token, (documentCount.get(token) ?? 0) + 1);
  }
  const idf = new Map();
  for (const [token, count] of documentCount) idf.set(token, Math.log(1 + sections.length / (1 + count)));
  return idf;
}

/** Two words that agree on their first four letters are treated as the same word, which is how Greek inflection reads. */
function sharePrefix(a, b) {
  const limit = Math.min(a.length, b.length);
  if (limit < 4) return false;
  let shared = 0;
  while (shared < limit && a[shared] === b[shared]) shared += 1;
  return shared >= 4;
}

/** True for the glossary section: a lookup table, useful for translating a question, not for answering one. */
const isGlossary = (section) => fold(section.heading).includes('glossar');

/**
 * Reads the glossary table into Greek-to-English word pairs. A question asked in Greek can then be matched against the
 * English sections that actually hold the answer.
 */
function parseGlossary(sections) {
  const pairs = [];
  for (const section of sections.filter(isGlossary)) {
    for (const line of section.content.split('\n')) {
      const cells = line.split('|').map((cell) => cell.trim()).filter(Boolean);
      if (cells.length !== 2 || /^[-\s|]+$/.test(cells[0])) continue;
      const from = new Set(cells[0].split('/').flatMap((variant) => tokenize(variant)));
      const to = [...new Set(tokenize(cells[1]))];
      if (from.size && to.length) pairs.push({ from, to });
    }
  }
  return pairs;
}

/** A knowledge base ready to answer from. */
export function createKnowledgeBase(markdown, { wholeBaseLimit = WHOLE_BASE_LIMIT, budget = RETRIEVAL_BUDGET } = {}) {
  // Editing notes are not knowledge, and they should not count against the size budget either.
  const content = String(markdown ?? '').replace(/<!--[\s\S]*?-->/g, '');
  const sections = parseSections(content);
  const idf = inverseFrequencies(sections);
  const glossary = parseGlossary(sections);
  const answerable = sections.filter((section) => !isGlossary(section));
  const lengths = answerable.map((section) => [...section.contentCounts.values()].reduce((a, b) => a + b, 0) || 1);
  const averageLength = lengths.reduce((a, b) => a + b, 0) / (lengths.length || 1);

  const totalChars = content.trim().length;
  const fitsWhole = totalChars > 0 && totalChars <= wholeBaseLimit;

  /**
   * The question's words, plus the English words the glossary says they mean. Greek inflects far past what the stemmer
   * trims — "επικοινωνία" and "επικοινωνήσω" share only a stem — so a glossary term also matches a question word they
   * agree on for their first four letters.
   */
  function expand(query) {
    const tokens = new Set(tokenize(query));
    if (!tokens.size) return [];
    const asked = [...tokens];
    for (const pair of glossary) {
      const hit = [...pair.from].some((word) => asked.some((token) => token === word || sharePrefix(token, word)));
      if (hit) for (const word of pair.to) tokens.add(word);
    }
    return [...tokens];
  }

  /**
   * Sections ranked against a question, most relevant first, scoreless ones dropped. Scoring follows BM25: a word counts
   * for more when it is rare, less each time it repeats, and less again when the section is long, so a sprawling table
   * cannot outrank the short section that actually answers the question.
   */
  function rank(query) {
    const tokens = expand(query);
    if (!tokens.length) return [];
    const k1 = 1.2;
    const b = 0.75;
    return answerable
      .map((section, index) => {
        const length = lengths[index];
        let score = 0;
        for (const token of tokens) {
          const weight = idf.get(token) ?? Math.log(1 + sections.length);
          // A heading is the section's strongest signal: a word in it says what the whole section is about.
          if (section.titleTokens.has(token)) score += weight * 4;
          const hits = section.contentCounts.get(token) ?? 0;
          if (hits) score += weight * ((hits * (k1 + 1)) / (hits + k1 * (1 - b + (b * length) / averageLength)));
        }
        return { section, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b2) => b2.score - a.score || a.section.level - b2.section.level)
      .map((entry) => entry.section);
  }

  /**
   * The context to put in front of the model for this question. Returns the whole base while it fits, otherwise the
   * best-scoring sections up to the budget, falling back to the opening sections when nothing matches.
   */
  function context(query) {
    if (!sections.length) return { text: '', headings: [], whole: false };
    if (fitsWhole) {
      return { text: sections.map(format).join('\n\n'), headings: sections.map((s) => s.heading), whole: true };
    }

    const ranked = rank(query);
    const chosen = [];
    let used = 0;
    for (const section of ranked.length ? ranked : answerable) {
      const block = format(section);
      if (chosen.length && used + block.length > budget) continue;
      chosen.push(section);
      used += block.length;
      if (used >= budget) break;
    }
    return { text: chosen.map(format).join('\n\n'), headings: chosen.map((s) => s.heading), whole: false };
  }

  return {
    sections,
    totalChars,
    sendsWholeBase: fitsWhole,
    rank,
    context,
    /** Shape shown on the health endpoint, so a deploy can be checked without guessing. */
    describe: () => ({ sections: sections.length, characters: totalChars, mode: fitsWhole ? 'whole-base' : 'retrieval' }),
  };
}

function format(section) {
  return `## ${section.heading}\n${section.content}`;
}

/** Reads knowledgebase.md from the usual places, so the server works whichever directory it is started from. */
export function loadKnowledgeBase(baseDir, options) {
  const candidates = [
    path.join(process.cwd(), 'knowledgebase.md'),
    path.join(baseDir, 'knowledgebase.md'),
    path.join(process.cwd(), 'backend', 'knowledgebase.md'),
  ];
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  const markdown = file ? fs.readFileSync(file, 'utf8') : '';
  return { file, base: createKnowledgeBase(markdown, options) };
}
