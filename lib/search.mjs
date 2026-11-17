// Spelling-tolerant transcript search over db/gita.db (SQLite FTS5).
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tokenize, soundKey, soundDistance, skeleton, tolerance } from './text.mjs';

const STOP = new Set(`a an and are as at be been but by can could did do does for from had has have he her his how i if in into is it its
me my no not of on or our she so some than that the their them then there these they this to us was we were what when where which who whom
why will with would you your about also any tell say says said talk talks speak explain explained explains describe swami swamiji mean means
meaning chapter verse verses shloka sloka gita bhagavad bg episode episodes please according`.split(/\s+/));
const VERSE_WORDS = ['verse', 'shloka', 'sloka', 'meaning', 'means', 'bhagavan', 'krishna', 'arjuna'];

const ENDINGS = /^(s|es|m|h|n|a|i|d|am|ah|as|ic|ed|er|ly|ing)?$/;

let db, N, episodes, stmt;
function open() {
  if (db) return;
  const file = [path.join(process.cwd(), 'db', 'gita.db'), path.resolve(import.meta.dirname, '..', 'db', 'gita.db')].find((f) => fs.existsSync(f));
  if (!file) throw new Error('Search index not found (db/gita.db). Run "npm run build".');
  db = new DatabaseSync(file, { readOnly: true });
  episodes = new Map(db.prepare('SELECT * FROM episodes').all().map((e) => [e.id, e]));
  N = db.prepare('SELECT COUNT(*) n FROM passages').get().n;
  stmt = {
    word: db.prepare('SELECT word, n FROM words WHERE word = ?'),
    prefix: db.prepare('SELECT word, n FROM words WHERE word >= ? AND word < ?'),
    sound: db.prepare('SELECT word, key, n FROM words WHERE k1 = ? AND length(key) BETWEEN ? AND ?'),
    pair: db.prepare('SELECT w1, w2, key, n FROM pairs WHERE k1 = ? AND length(key) BETWEEN ? AND ?'),
    match: db.prepare('SELECT rowid AS id, ep FROM passages WHERE passages MATCH ?'),
    get: db.prepare('SELECT rowid AS id, text, ep, start FROM passages WHERE rowid = ?'),
    inEp: db.prepare('SELECT rowid AS id, text, ep, start FROM passages WHERE ep = ? AND rowid BETWEEN ? AND ?'),
  };
}

// All spellings in the transcripts that plausibly mean `term`, each with a
// closeness between 0 and 1 (1 = exactly what was typed).
function variants(term, strict = false) {
  const out = new Map();                       // fts expression -> { label, q }
  const add = (label, q) => { const k = `"${label}"`; if (!out.has(k) || out.get(k).q < q) out.set(k, { label, q }); };
  const exact = stmt.word.get(term);
  if (exact) add(term, 1);
  if (/^\d+$/.test(term)) return out;
  if (term.length >= 4) {                      // plural / case endings: guna -> gunas, dharma -> dharmam
    for (const r of stmt.prefix.all(term, term + '￿')) if (ENDINGS.test(r.word.slice(term.length))) add(r.word, 0.9);
    const shorter = stmt.word.get(term.slice(0, -1));
    if (shorter && /[sm]$/.test(term)) add(shorter.word, 0.9);
  }
  const key = soundKey(term);
  let { max, vowelOnly } = tolerance(key.length);
  if (strict) max = Math.min(max, 1);
  if (!key || max === 0) return out;
  if (exact && exact.n > 80) {                 // common, well-captioned word: trust its consonants
    if (key.length <= 6) return out;
    vowelOnly = true;
  }
  const sk = skeleton(key), lo = key.length - Math.ceil(max * 2), hi = key.length + Math.ceil(max * 2);
  const dist = (k) => (vowelOnly && skeleton(k) !== sk ? Infinity : soundDistance(key, k, max));
  const found = [];
  for (const r of stmt.sound.all(key[0], lo, hi)) { if (r.n > 80) continue; const d = dist(r.key); if (d <= max) found.push([r.word, d, r.n]); }
  if (key.length >= 7) for (const r of stmt.pair.all(key[0], lo, hi)) { const d = dist(r.key); if (d <= max) found.push([`${r.w1} ${r.w2}`, d, r.n]); }
  found.sort((x, y) => x[1] - y[1] || y[2] - x[2]);
  for (const [label, d] of found.slice(0, 14)) add(label, 1 - 0.2 * d);
  return out;
}

function parseScope(text) {
  let chapter = null, verse = null, m;
  if ((m = text.match(/(?<![\d.])(\d{1,2})\s*[.:]\s*(\d{1,2})(?![\d])/))) { chapter = +m[1]; verse = +m[2]; }
  else {
    if ((m = text.match(/chapter\s+(\d{1,2})/i))) chapter = +m[1];
    if ((m = text.match(/(?:verse|shloka|sloka)\s+(\d{1,2})/i))) verse = +m[1];
  }
  return { chapter, verse };
}

function episodesFor({ chapter, verse }) {
  if (!chapter) return null;
  const all = [...episodes.values()].filter((e) => e.chapter === chapter);
  if (!verse) return all.length ? new Set(all.map((e) => e.id)) : null;
  const hit = all.filter((e) => e.v_from != null && verse >= e.v_from && verse <= e.v_to);
  return hit.length ? new Set(hit.map((e) => e.id)) : null;
}

/**
 * search(query, { chapter, verse, limit }) ->
 *   { moments: [{ id, episode, title, videoId, start, text, context, matched }], scope, spellings }
 */
export function search(query, opts = {}) {
  open();
  const limit = opts.limit || 16;
  const parsed = parseScope(query);
  const scope = { chapter: opts.chapter ?? parsed.chapter, verse: opts.verse ?? parsed.verse };
  const scopeEps = episodesFor(scope);
  const stripped = query.replace(/(?<![\d.])\d{1,2}\s*[.:]\s*\d{1,2}(?![\d])/g, ' ').replace(/(chapter|verse|shloka|sloka)\s+\d{1,2}/gi, ' ');
  const terms = [...new Set(tokenize(stripped))].filter((t) => !STOP.has(t) && t.length > 1).slice(0, 12);

  const groups = [];
  let strongest = 0;
  const addGroup = (label, vs, weight = 1, main = true) => {
    const hits = new Map();                              // passage id -> { ep, q }
    for (const [expr, v] of vs) for (const r of stmt.match.all(expr)) {
      const h = hits.get(r.id);
      if (!h || h.q < v.q) hits.set(r.id, { ep: r.ep, q: v.q });
    }
    if (!hits.size) return;
    const w = weight * Math.log(1 + N / hits.size);
    groups.push({ label, hits, weight: w, main, spellings: [...vs.values()].map((v) => v.label) });
  };
  const one = (w) => new Map([[`"${w}"`, { label: w, q: 1 }]]);
  for (const t of terms) {
    const vs = variants(t);
    addGroup(t, vs);
    // A long compound the captions rarely keep whole ("sthitaprajna" is heard as "stitty", "pragya"):
    // also look for its two halves.
    const direct = groups.length && groups[groups.length - 1].label === t ? groups[groups.length - 1].hits.size : 0;
    if (t.length >= 9 && direct < 12 && !stmt.word.get(t)) {
      let best = null;
      for (let i = 4; i <= t.length - 4; i++) {
        const a = variants(t.slice(0, i), true), b = variants(t.slice(i), true);
        const size = Math.min(a.size, b.size);
        if (size && (!best || size > best.size)) best = { a, b, size, la: t.slice(0, i), lb: t.slice(i) };
      }
      if (best) {
        if (direct) groups[groups.length - 1].main = false;
        addGroup(best.la, best.a, 0.6); addGroup(best.lb, best.b, 0.6);
      }
    }
  }
  for (let i = 0; i + 1 < terms.length; i++) {            // "sthita prajna" typed as two words
    const joined = terms[i] + terms[i + 1];
    if (soundKey(joined).length >= 7) addGroup(joined, variants(joined, true), 0.5, false);
  }
  const verseOnly = !groups.length && scopeEps && scope.verse;
  if (verseOnly) {
    addGroup('verse ' + scope.verse, new Map([...one(String(scope.verse)), ...one(scope.verse + 'th')]), 2);
    for (const w of VERSE_WORDS) addGroup(w, one(w), 0.25, false);
  }

  const score = new Map(), matched = new Map();
  const tally = (onlyScope) => {
    const base = new Map(); matched.clear(); score.clear();
    for (const g of groups) for (const [id, h] of g.hits) {
      if (onlyScope && !scopeEps.has(h.ep)) continue;
      base.set(id, (base.get(id) || 0) + g.weight * h.q);
      (matched.get(id) || matched.set(id, []).get(id)).push(g);
    }
    // A passage whose neighbours also match is part of a sustained discussion: nudge it up.
    for (const [id, s] of base) score.set(id, s + 0.1 * ((base.get(id - 1) || 0) + (base.get(id + 1) || 0)));
  };
  strongest = Math.max(0, ...groups.filter((g) => g.main).map((g) => g.weight));
  const rank = () => {
    const r = [...score.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const floor = r.length ? Math.min(r[0][1] * 0.6, strongest * 0.85) : 0;   // must at least hit the most distinctive word
    return r.filter(([, s]) => s >= floor).slice(0, limit * 4);
  };
  const scoped = !!scopeEps;
  tally(scoped);
  let ranked = rank();
  if (scoped && !verseOnly && ranked.length < limit) {      // not enough in that chapter: top up from everywhere
    const have = new Set(ranked.map(([id]) => id));
    tally(false);
    ranked = ranked.concat(rank().filter(([id]) => !have.has(id)));
  }

  // Merge neighbouring hits in one episode into a single moment.
  const picked = [], taken = new Set();
  const perEpCap = verseOnly ? Math.ceil(limit / scopeEps.size) : Math.max(4, Math.ceil(limit / 2)), perEp = new Map();
  for (const [id] of ranked) {
    if (picked.length >= limit) break;
    if (taken.has(id) || taken.has(id - 1) || taken.has(id + 1)) { taken.add(id); continue; }
    const p = stmt.get.get(id);
    if ((perEp.get(p.ep) || 0) >= perEpCap) continue;
    perEp.set(p.ep, (perEp.get(p.ep) || 0) + 1);
    taken.add(id);
    const e = episodes.get(p.ep);
    const around = stmt.inEp.all(p.ep, id - 1, id + 2);
    const gs = matched.get(id) || [];
    const words = new Set();
    for (const g of gs) for (const s of g.spellings) for (const w of s.split(' ')) words.add(w);
    picked.push({
      id, episode: p.ep, title: e.title, videoId: e.video_id, chapter: e.chapter, start: p.start, text: p.text,
      context: around.map((r) => r.text).join(' '), score: +score.get(id).toFixed(2), inScope: !scopeEps || scopeEps.has(p.ep),
      matched: tokenize(p.text).filter((w, i, a) => words.has(w) && a.indexOf(w) === i),
    });
  }
  const spellings = {};
  for (const g of groups) if (g.spellings.length > 1 || g.spellings[0] !== g.label) spellings[g.label] = g.spellings.slice(0, 12);
  return { moments: picked, scope: scopeEps ? scope : null, spellings, terms };
}

export function episodeList() { open(); return [...episodes.values()]; }
