// GET /api/search?q=...&limit=40  -> plain transcript search, no AI. Used by "Show more moments".
import { search } from '../lib/search.mjs';

export default function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const q = (url.searchParams.get('q') || '').slice(0, 300);
  const limit = Math.min(40, Math.max(1, +url.searchParams.get('limit') || 30));
  const out = q.trim() ? search(q, { limit }) : { moments: [], spellings: {} };
  out.moments = out.moments.map(({ context, score, ...m }) => m);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600');
  res.end(JSON.stringify(out));
}
