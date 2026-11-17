// Builds db/gita.db and public/stats.json from data/ep_*.json.
// Runs on every Vercel deploy (npm run build), so new episodes only need a new JSON file.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { tokenize, soundKey, parseVerses } from '../lib/text.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'data');
const DB = path.join(ROOT, 'db', 'gita.db');
const LINES_PER_PASSAGE = 8;

fs.mkdirSync(path.dirname(DB), { recursive: true });
fs.rmSync(DB, { force: true });
const db = new DatabaseSync(DB);
db.exec(`
  PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;
  CREATE TABLE episodes (id INTEGER PRIMARY KEY, video_id TEXT, title TEXT, chapter INT, v_from INT, v_to INT, seconds INT);
  CREATE VIRTUAL TABLE passages USING fts5(text, ep UNINDEXED, start UNINDEXED, tokenize = 'unicode61 remove_diacritics 2');
  CREATE TABLE words (word TEXT PRIMARY KEY, key TEXT, k1 TEXT, n INT) WITHOUT ROWID;
  CREATE TABLE pairs (w1 TEXT, w2 TEXT, key TEXT, k1 TEXT, n INT);
`);

const clean = (t) => t.replace(/\[[^\]]{0,30}\]/g, ' ').replace(/\s+/g, ' ').trim();

const files = fs.readdirSync(DATA).filter((f) => /^ep_\d+\.json$/.test(f)).sort();
const insEp = db.prepare('INSERT INTO episodes VALUES (?,?,?,?,?,?,?)');
const insP = db.prepare('INSERT INTO passages (text, ep, start) VALUES (?,?,?)');
const wordCount = new Map(), pairCount = new Map(), seen = new Set();
let passages = 0, words = 0, seconds = 0, episodes = 0;

db.exec('BEGIN');
for (const f of files) {
  const ep = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
  if (!ep.video_id || seen.has(ep.video_id)) continue;      // never index the same video twice
  seen.add(ep.video_id);
  const id = ep.episode ?? +f.match(/\d+/)[0];
  const segs = (ep.segments || []).map((s) => ({ ...s, text: clean(s.text) })).filter((s) => s.text);
  if (!segs.length) continue;
  const v = parseVerses(ep.title);
  const dur = segs[segs.length - 1].start_seconds;
  insEp.run(id, ep.video_id, ep.title, v.chapter, v.from, v.to, dur);
  episodes++; seconds += dur;
  for (let i = 0; i < segs.length; i += LINES_PER_PASSAGE) {
    const chunk = segs.slice(i, i + LINES_PER_PASSAGE);
    const text = chunk.map((s) => s.text).join(' ');
    const toks = tokenize(text);
    if (!toks.length) continue;
    insP.run(text, id, chunk[0].start_seconds);
    passages++; words += toks.length;
    for (let j = 0; j < toks.length; j++) {
      wordCount.set(toks[j], (wordCount.get(toks[j]) || 0) + 1);
      if (j) { const k = toks[j - 1] + ' ' + toks[j]; pairCount.set(k, (pairCount.get(k) || 0) + 1); }
    }
  }
}

// Vocabulary with sound keys, for spelling-tolerant lookup.
const insW = db.prepare('INSERT INTO words VALUES (?,?,?,?)');
for (const [w, n] of wordCount) {
  const key = soundKey(w);
  if (key) insW.run(w, key, key[0], n);
}
// Two-word spellings of one Sanskrit word ("stitty pragya", "nish karma"):
// keep pairs where at least one half is an uncommon word.
const insPair = db.prepare('INSERT INTO pairs VALUES (?,?,?,?,?)');
let pairs = 0;
for (const [k, n] of pairCount) {
  const [a, b] = k.split(' ');
  const na = wordCount.get(a), nb = wordCount.get(b);
  if (Math.min(na, nb) > 40 || Math.max(na, nb) > 3000) continue;
  const ka = soundKey(a), kb = soundKey(b);
  if (ka.length < 2 || kb.length < 2 || ka.length + kb.length < 7) continue;
  const key = soundKey(a + b);
  insPair.run(a, b, key, key[0], n); pairs++;
}
db.exec('COMMIT');
db.exec('CREATE INDEX words_k1 ON words (k1); CREATE INDEX pairs_k1 ON pairs (k1); VACUUM;');
db.close();

// Fonts come from npm (open-licensed) and are copied next to the page so they load from our own domain.
const FONTS = {
  '@fontsource/tiro-devanagari-sanskrit/files/tiro-devanagari-sanskrit-latin-400-normal.woff2': 'tiro-latin-400-normal.woff2',
  '@fontsource/tiro-devanagari-sanskrit/files/tiro-devanagari-sanskrit-latin-400-italic.woff2': 'tiro-latin-400-italic.woff2',
  '@fontsource/tiro-devanagari-sanskrit/files/tiro-devanagari-sanskrit-latin-ext-400-normal.woff2': 'tiro-latin-ext-400-normal.woff2',
  '@fontsource/mukta/files/mukta-latin-400-normal.woff2': 'mukta-latin-400-normal.woff2',
  '@fontsource/mukta/files/mukta-latin-600-normal.woff2': 'mukta-latin-600-normal.woff2',
};
fs.mkdirSync(path.join(ROOT, 'public', 'fonts'), { recursive: true });
for (const [from, to] of Object.entries(FONTS)) {
  const src = path.join(ROOT, 'node_modules', from);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(ROOT, 'public', 'fonts', to));
  else console.warn('Font not found (run "npm install"):', from);
}

const chapters = {};
const meta = new DatabaseSync(DB, { readOnly: true });
for (const r of meta.prepare('SELECT chapter, MIN(v_from) a, MAX(v_to) b, COUNT(*) n FROM episodes WHERE chapter IS NOT NULL GROUP BY chapter').all())
  chapters[r.chapter] = { from: r.a, to: r.b, episodes: r.n };
meta.close();

const stats = { episodes, passages, words, hours: Math.round(seconds / 3600), chapters, built: new Date().toISOString().slice(0, 10) };
fs.mkdirSync(path.join(ROOT, 'public'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'public', 'stats.json'), JSON.stringify(stats));
console.log(`Indexed ${episodes} episodes, ${passages} passages, ${words} words, ${wordCount.size} distinct words, ${pairs} word pairs.`);
console.log(`Database: ${(fs.statSync(DB).size / 1e6).toFixed(1)} MB`);
