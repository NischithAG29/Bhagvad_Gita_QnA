// Shared text helpers: tokenising, and a "sound key" that lets differently
// spelled Sanskrit words (nishkama / nishkam / nishkm) land close together.

export function tokenize(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().match(/[a-z0-9]+/g) || [];
}

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y']);

export function soundKey(word) {
  let w = word.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return '';
  w = w.replace(/jny|gny|jn|gn|gy/g, 'g').replace(/w/g, 'v').replace(/q/g, 'k').replace(/z/g, 'j');
  w = w.replace(/([^aeiouy])h+/g, '$1');            // aspirates: sh, th, dh, bh, kh...
  w = w.replace(/h$/, '');                           // visarga: dharmah
  w = w.replace(/aa+/g, 'a').replace(/ee+|ii+/g, 'i').replace(/oo+|uu+/g, 'u');
  w = w.replace(/([a-z])\1+/g, '$1');               // doubled letters
  if (w[0] === 'y') w = 'j' + w.slice(1);            // leading y is a consonant; keep it distinct
  return w;
}

export const isVowel = (c) => VOWELS.has(c);
export const skeleton = (key) => [...key].filter((c, i) => i === 0 || !VOWELS.has(c)).join('');

const SIMILAR = new Set(['td', 'kg', 'bp', 'vb', 'sc', 'jg', 'nm', 'ck', 'sj'].flatMap((p) => [p, p[1] + p[0]]));

// Edit distance where vowel slips are cheap (0.5), a dropped or added consonant costs 1,
// and swapping one consonant for an unrelated one costs 2.
export function soundDistance(a, b, max) {
  const n = a.length, m = b.length;
  if (Math.abs(n - m) > max * 2) return Infinity;
  let prev = new Float32Array(m + 1), cur = new Float32Array(m + 1);
  for (let j = 1; j <= m; j++) prev[j] = prev[j - 1] + (VOWELS.has(b[j - 1]) ? 0.5 : 1);
  for (let i = 1; i <= n; i++) {
    const ca = a[i - 1], va = VOWELS.has(ca);
    cur[0] = prev[0] + (va ? 0.5 : 1);
    let rowMin = cur[0];
    for (let j = 1; j <= m; j++) {
      const cb = b[j - 1], vb = VOWELS.has(cb);
      const sub = ca === cb ? 0 : va && vb ? 0.5 : SIMILAR.has(ca + cb) ? 1 : 2;
      const v = Math.min(prev[j - 1] + sub, prev[j] + (va ? 0.5 : 1), cur[j - 1] + (vb ? 0.5 : 1));
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return Infinity;
    [prev, cur] = [cur, prev];
  }
  return prev[m];
}

// How much misspelling to tolerate for a key of this length.
export function tolerance(len) {
  if (len <= 3) return { max: 0, vowelOnly: true };
  if (len === 4) return { max: 0.5, vowelOnly: true };
  if (len <= 6) return { max: 1, vowelOnly: true };
  if (len <= 9) return { max: 1.5, vowelOnly: false };
  return { max: 2.5, vowelOnly: false };
}

// "Bhagavad Gita 2.47 - 2.48" -> { chapter: 2, from: 47, to: 48 }
export function parseVerses(title) {
  const refs = [...title.matchAll(/(?<![\d.])(\d{1,2})\.(\d{1,2})(?![\d])/g)].map((m) => [+m[1], +m[2]]);
  if (refs.length) {
    const ch = refs[0][0];
    const vs = refs.filter((r) => r[0] === ch).map((r) => r[1]);
    return { chapter: ch, from: Math.min(...vs), to: Math.max(...vs) };
  }
  const m = title.match(/Gita\s+Chapter\s+(\d{1,2})/i);
  return m ? { chapter: +m[1], from: null, to: null } : { chapter: null, from: null, to: null };
}
